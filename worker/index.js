/* Upstream auth API. Cloudflare Worker + D1. Only /api/* reaches this code; the site itself is static assets.
   POST /api/signup  {username, email, password}  -> 201 {user}   + session cookie
   POST /api/login   {username | email, password}  -> 200 {user}   + session cookie
   POST /api/logout                        -> 200
   GET  /api/me                            -> 200 {user: {id, name} | null} */

const PBKDF2_ITER = 100000; // the Workers runtime rejects more than 100000
const SESSION_DAYS = 30;
const MAX_FAILS = 5, FAIL_WINDOW_S = 15 * 60;
const COOKIE = '__Host-upstream_session';

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

const enc = new TextEncoder();
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
const now = () => Math.floor(Date.now() / 1000);

async function hashPassword(pw, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return toB64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
async function sha256(text) { return toB64(await crypto.subtle.digest('SHA-256', enc.encode(text))); }
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validate(username, email, password) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9_.-]{3,20}$/.test(username)) return 'Username: 3 to 20 letters, numbers, dots, dashes or underscores.';
  if (typeof email !== 'string' || email.length > 254 || !EMAIL_RE.test(email)) return 'Enter a valid email address.';
  if (typeof password !== 'string' || password.length < 8 || password.length > 20) return 'Password must be 8 to 20 characters.';
  if (!/\d/.test(password)) return 'Password needs at least 1 number.';
  if (!/[^A-Za-z0-9\s]/.test(password)) return 'Password needs at least 1 special character.';
  return null;
}

function cookieValue(req, name) {
  const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
const setCookie = (token, maxAge) => `${COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

async function startSession(env, userId) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const ttl = SESSION_DAYS * 86400;
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), userId, now() + ttl).run();
  return setCookie(token, ttl);
}

async function currentUser(env, req) {
  const token = cookieValue(req, COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare('SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(await sha256(token), now()).first();
  return row ? { id: row.id, name: row.username } : null;
}

async function readBody(req) {
  if (!(req.headers.get('content-type') || '').includes('application/json')) return null;
  try { return await req.json(); } catch { return null; }
}

async function signup(env, req) {
  const body = await readBody(req);
  if (!body) return json({ error: 'Invalid request.' }, 400);
  const { username, password } = body;
  const email = typeof body.email === 'string' ? body.email.trim() : body.email;
  const bad = validate(username, email, password);
  if (bad) return json({ error: bad }, 400);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(password, salt, PBKDF2_ITER);
  let id;
  try {
    const r = await env.DB.prepare('INSERT INTO users (username, username_lc, email, email_lc, pw_hash, salt, iter, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(username, username.toLowerCase(), email, email.toLowerCase(), hash, toB64(salt), PBKDF2_ITER, now()).run();
    id = r.meta.last_row_id;
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) {
      return json({ error: /email/i.test(String(e.message)) ? 'An account with that email already exists. Try logging in.' : 'That username is taken. Try another, or log in.' }, 409);
    }
    throw e;
  }
  return json({ user: { id, name: username } }, 201, { 'set-cookie': await startSession(env, id) });
}

async function login(env, req) {
  const body = await readBody(req);
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') return json({ error: 'Enter your username and password.' }, 400);
  const lc = body.username.trim().toLowerCase();
  const failKey = lc.slice(0, 40) + '|' + (req.headers.get('cf-connecting-ip') || 'unknown');
  const since = now() - FAIL_WINDOW_S;
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_fails WHERE key = ? AND at > ?').bind(failKey, since).first();
  if (n >= MAX_FAILS) return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);

  const u = await env.DB.prepare('SELECT id, username, pw_hash, salt, iter FROM users WHERE username_lc = ? OR email_lc = ?').bind(lc, lc).first();
  // hash even for an unknown user so timing does not reveal which usernames exist
  const got = await hashPassword(body.password.slice(0, 200), u ? fromB64(u.salt) : new Uint8Array(16), u ? u.iter : PBKDF2_ITER);
  if (!u || !safeEqual(got, u.pw_hash)) {
    await env.DB.prepare('INSERT INTO login_fails (key, at) VALUES (?, ?)').bind(failKey, now()).run();
    return json({ error: 'Incorrect username or password.' }, 401);
  }
  await env.DB.prepare('DELETE FROM login_fails WHERE key = ?').bind(failKey).run();
  return json({ user: { id: u.id, name: u.username } }, 200, { 'set-cookie': await startSession(env, u.id) });
}

async function logout(env, req) {
  const token = cookieValue(req, COOKIE);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return json({ ok: true }, 200, { 'set-cookie': setCookie('', 0) });
}

async function housekeeping(env) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now()),
    env.DB.prepare('DELETE FROM login_fails WHERE at < ?').bind(now() - FAIL_WINDOW_S),
  ]);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      if (req.method === 'POST') {
        // CSRF: browsers send Origin on cross-site POSTs; refuse any that is not this site
        const origin = req.headers.get('origin');
        if (origin && new URL(origin).host !== url.host) return json({ error: 'Forbidden.' }, 403);
      }
      const route = req.method + ' ' + url.pathname;
      if (route === 'GET /api/me') return json({ user: await currentUser(env, req) });
      if (route === 'POST /api/signup') { ctx.waitUntil(housekeeping(env)); return await signup(env, req); }
      if (route === 'POST /api/login') return await login(env, req);
      if (route === 'POST /api/logout') return await logout(env, req);
      return json({ error: 'Not found.' }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: 'Something went wrong. Please try again.' }, 500);
    }
  },
};
