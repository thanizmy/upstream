/* Upstream front end. No build step; reads data/brief.json. */
(function () {
  'use strict';
  var BAND = ['', 'Quiet', 'Routine', 'Elevated', 'High', 'Critical'];
  var TH = { conflict: 'Conflict', disaster: 'Disaster', health: 'Health', persecution: 'Persecution', hunger: 'Hunger', displacement: 'Displacement', unrest: 'Unrest', politics: 'Politics', other: 'Other' };
  var WK = 'upstream.watch.v2', PK = 'upstream.pray.v1';
  var D, byCc = {};

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function safeUrl(u) { try { var x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (e) { return ''; } }
  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function today() { return new Date().toISOString().slice(0, 10); }
  function ago(d) {
    var n = Math.round((Date.now() - new Date(d + 'T12:00:00Z')) / 864e5);
    return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + 'd ago';
  }
  function kc(n) { return 'var(--s' + Math.max(1, Math.min(5, n || 1)) + ')'; }
  function pips(n) {
    var h = ''; for (var i = 1; i <= 5; i++) h += '<i class="' + (i <= n ? 'on' : '') + '"></i>';
    return '<span class="pips" style="--k:' + kc(n) + '" title="severity ' + n + ' of 5">' + h + '</span>';
  }
  function bandChip(n) { return '<span class="band" style="--k:' + kc(n) + '">' + BAND[n] + '</span>'; }
  function fmtDate(iso) { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }

  /* ── state ─────────────────────────────────────────── */
  function watchList() {
    var w = load(WK, null);
    if (Array.isArray(w) && w.length) return { list: w.filter(function (c) { return byCc[c]; }), custom: true };
    return { list: D.top5.slice(), custom: false };
  }
  function pray() {
    var p = load(PK, {});
    return { countries: p.countries || [], heads: p.heads || [], done: p.done || {} };
  }
  function savePray(p) { save(PK, p); }

  /* ── pieces ────────────────────────────────────────── */
  function spark(c) {
    var S = c.series, W = 320, H = 46, n = S.n.length, gap = 2, bw = (W - (n - 1) * gap) / n, mx = Math.max.apply(null, S.n) || 1, b = '';
    for (var i = 0; i < n; i++) {
      var h = S.n[i] ? Math.max(3, S.n[i] / mx * (H - 3)) : 0;
      b += '<rect x="' + (i * (bw + gap)).toFixed(1) + '" y="' + (H - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" style="--k:' + kc(S.s[i]) + '"><title>' + S.n[i] + ' event' + (S.n[i] === 1 ? '' : 's') + '</title></rect>';
    }
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Events per day, last 21 days">' + b + '<line class="base" x1="0" y1="' + H + '" x2="' + W + '" y2="' + H + '"/></svg>';
  }
  function trendHtml(c) {
    var t = c.trend;
    if (!t) return '<span class="flat">trend after 1 week of history</span>';
    if (t.dir === 'up') return '<span class="up">&#9650; ' + (t.pct == null ? 'new activity' : t.pct + '% vs last week') + '</span>';
    if (t.dir === 'down') return '<span class="down">&#9660; ' + Math.abs(t.pct) + '% vs last week</span>';
    return '<span class="flat">flat vs last week</span>';
  }
  function evRow(e, c, withPray) {
    var u = safeUrl(e.u);
    return '<div class="urow"><span>' + pips(e.s) + '</span>' +
      '<a class="ev" href="' + esc(u) + '" target="_blank" rel="noopener"><span class="h">' + esc(e.h) + '</span>' +
      '<span class="m">' + esc(e.src) + ' · ' + esc(TH[e.th] || '') + ' · ' + e.o + ' outlet' + (e.o > 1 ? 's' : '') + ' · ' + ago(e.d) + '</span></a>' +
      (withPray ? '<button class="linkbtn" data-pin="' + esc(e.id) + '" data-cc="' + esc(c.cc) + '" type="button">+ Pray</button>' : '<span></span>') + '</div>';
  }
  function countryCard(c, o) {
    o = o || {};
    var done = pray().done[c.cc] === today();
    return '<article class="card"><h3><span class="fl">' + c.fl + '</span>' + esc(c.k) + bandChip(c.band) + '</h3>' +
      '<p class="stats"><b>' + c.events7 + '</b> events · ' + c.reports7 + ' reports this week · ' + trendHtml(c) + '</p>' +
      spark(c) +
      '<div class="prayer">' + esc(c.prayer.text) + '</div>' +
      '<div>' + c.top.slice(0, o.events || 2).map(function (e) { return evRow(e, c, true); }).join('') + '</div>' +
      '<div class="acts">' +
      (o.prayed ? '<button class="btn ' + (done ? 'done' : '') + '" data-done="' + c.cc + '" type="button">' + (done ? 'Prayed today ✓' : 'Mark as prayed today') + '</button>' : '<button class="btn ghost" data-addp="' + c.cc + '" type="button">Add to prayer space</button>') +
      (o.remove ? '<button class="btn ghost" data-' + o.remove + '="' + c.cc + '" type="button">Remove</button>' : '') +
      '</div></article>';
  }
  function findEvent(id, cc) {
    var c = byCc[cc]; if (c) { var e = c.top.filter(function (x) { return x.id === id; })[0]; if (e) return e; }
    var u = D.urgent.filter(function (x) { return x.id === id; })[0]; return u || null;
  }

  /* ── brief tab ─────────────────────────────────────── */
  function renderBrief() {
    var hot = D.countries.filter(function (c) { return c.band >= 4; }).length;
    $('dateline').textContent = 'Situation brief · updated ' + fmtDate(D.generated) + ' · ' + D.feeds.ok + ' of ' + D.feeds.total + ' sources live';
    $('heroLine').innerHTML = '<b>' + hot + '</b> of ' + D.countries.length + ' countries with recent reporting are at High or Critical. <b>' + D.urgent.length + '</b> confirmed serious events landed in the last 72 hours. Your countries are first; the rest of the world is at the bottom.';

    var w = watchList();
    $('watchMode').textContent = w.custom ? 'Your own list, saved on this device' : 'Default: the five most urgent right now';
    $('chips').innerHTML = w.list.map(function (cc) {
      var c = byCc[cc]; return '<span class="chip">' + c.fl + ' ' + esc(c.k) + '<button type="button" data-unwatch="' + cc + '" aria-label="Remove ' + esc(c.k) + '">&times;</button></span>';
    }).join('') + '<input type="search" id="wAdd" list="countryList" placeholder="Add a country…" aria-label="Add a country to your list" autocomplete="off">' +
      (w.custom ? '<button class="linkbtn" type="button" id="wReset">Reset to top 5 most urgent</button>' : '');
    $('watch').innerHTML = w.list.map(function (cc) { return countryCard(byCc[cc], { events: 2 }); }).join('');

    var set = {}; w.list.forEach(function (c) { set[c] = 1; });
    var mine = D.urgent.filter(function (u) { return set[u.cc]; });
    var other = D.urgent.filter(function (u) { return !set[u.cc]; });
    $('urgentCount').textContent = mine.length + ' in your countries · ' + other.length + ' elsewhere';
    $('urgentMine').innerHTML = mine.length ? mine.map(urgentRow).join('') : '<div class="empty">Nothing at severity 4 or above, confirmed by two sources, in your countries in the last 72 hours. That is a real reading, not an empty feed.</div>';
    $('urgentMine').style.display = 'block';
    $('urgentOtherLabel').textContent = 'Elsewhere in the world (' + other.length + ')';
    $('urgentOther').innerHTML = other.map(urgentRow).join('');
    $('urgentOtherWrap').hidden = !other.length;
    renderExplore();
  }
  function urgentRow(u) {
    var url = safeUrl(u.u), c = byCc[u.cc] || { cc: u.cc };
    return '<div class="urow"><span>' + pips(u.s) + '</span><a class="ev" href="' + esc(url) + '" target="_blank" rel="noopener"><span class="h">' + esc(u.h) + '</span>' +
      '<span class="m">' + u.fl + ' ' + esc(u.c) + ' · ' + esc(TH[u.th] || '') + ' · ' + u.o + ' outlets · ' + ago(u.d) + '</span></a>' +
      '<button class="linkbtn" data-pin="' + esc(u.id) + '" data-cc="' + esc(c.cc) + '" type="button">+ Pray</button></div>';
  }
  function renderExplore() {
    var q = $('q').value.trim().toLowerCase(), r = $('region').value;
    var rows = D.countries.filter(function (c) { return (!q || c.k.toLowerCase().indexOf(q) >= 0) && (!r || c.region === r); });
    $('explore').innerHTML = rows.map(function (c) {
      return '<details><summary><span class="fl">' + c.fl + '</span><span>' + esc(c.k) + '</span>' + bandChip(c.band) + '<span class="ht">' + esc(c.top[0].h) + '</span></summary>' +
        '<div class="body"><p class="stats"><b>' + c.events7 + '</b> events · ' + c.reports7 + ' reports this week · ' + trendHtml(c) + '</p>' +
        '<div class="prayer">' + esc(c.prayer.text) + '</div>' +
        c.top.slice(0, 5).map(function (e) { return evRow(e, c, true); }).join('') +
        '<div class="acts"><button class="btn" data-watch="' + c.cc + '" type="button">Follow this country</button><button class="btn ghost" data-addp="' + c.cc + '" type="button">Add to prayer space</button></div></div></details>';
    }).join('') || '<div class="empty" style="padding:14px">No matching countries with recent reporting.</div>';
  }

  /* ── prayer tab ────────────────────────────────────── */
  function renderPrayer() {
    var p = pray(), w = watchList(), follow = w.custom ? w.list : [];
    var all = [], tag = {};
    follow.forEach(function (c) { if (all.indexOf(c) < 0) all.push(c); tag[c] = 'following'; });
    p.countries.forEach(function (c) { if (all.indexOf(c) < 0) { all.push(c); tag[c] = 'added'; } });
    $('pcSub').textContent = all.length ? 'Followed countries refresh automatically' : '';
    $('pcards').innerHTML = all.filter(function (c) { return byCc[c]; }).map(function (cc) {
      var html = countryCard(byCc[cc], { events: 3, prayed: true, remove: tag[cc] === 'added' ? 'rmp' : 'unwatch' });
      return html.replace('<h3>', '<h3>').replace('</h3>', '<small class="sub">' + (tag[cc] === 'following' ? ' · following' : ' · added by you') + '</small></h3>');
    }).join('') || '<div class="empty">No countries yet. Add one above, or follow countries from the Brief and they will appear here automatically.</div>';
    $('phSub').textContent = p.heads.length ? p.heads.length + ' saved' : '';
    $('pheads').innerHTML = p.heads.map(function (h, i) {
      var u = safeUrl(h.u || '');
      return '<div class="urow"><span>' + (h.s ? pips(h.s) : '') + '</span><div class="ev"><span class="h">' + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(h.t) + '</a>' : esc(h.t)) + '</span>' +
        '<span class="m">' + (h.fl ? h.fl + ' ' + esc(h.c) + ' · ' : '') + 'saved ' + ago(h.added) + '</span></div><button class="linkbtn" data-rmh="' + i + '" type="button">Remove</button></div>';
    }).join('') || '<div class="empty">Nothing saved. Use “+ Pray” beside any headline in the Brief, or write your own request above.</div>';
  }

  /* ── about ─────────────────────────────────────────── */
  function renderAbout() {
    $('aboutBody').innerHTML =
      '<p>Upstream gives international ministry staff a quick read on the countries they serve: what is urgent, what is changing, and what to pray for. It reads public RSS and Atom feeds from ' + D.feeds.total + ' news, humanitarian and faith outlets and refreshes about every three hours.</p>' +
      '<h3>How a country gets its level</h3><ol>' +
      '<li><b>Unique events, not articles.</b> Reports about the same incident are grouped into one event, so a country with 100 articles on one flood does not outrank a country with one new crisis.</li>' +
      '<li><b>Urgency-weighted.</b> An event counts 1, 3, 9, 27 or 81 by severity (1 to 5). One severity-5 event outweighs ten severity-2 events. A single-source event is capped at severity 4.</li>' +
      '<li><b>Compared with the country itself.</b> Once about three weeks of history exist, each country is compared with its own recent weeks, so ordinarily busy countries are not flagged just for being busy.</li></ol>' +
      '<table><tr><th>Level</th><th>Rule</th></tr><tr><td>Critical</td><td>A severity-5 event confirmed by two sources in 7 days, or far above its own normal</td></tr><tr><td>High</td><td>A severity-4 event in 7 days, or well above its normal</td></tr><tr><td>Elevated</td><td>Three or more severity-3 events, or above its normal</td></tr><tr><td>Routine</td><td>Some reporting, nothing serious</td></tr><tr><td>Quiet</td><td>No recent reporting</td></tr></table>' +
      '<h3>Your countries and the default five</h3><p>Until you pick your own list, the top of the page shows the five most urgent countries at the moment you open it. Your list and prayer space are stored in this browser only.</p>' +
      '<h3>What it cannot do</h3><ul><li>Severity comes from keyword rules, not a person reading the story. Expect misses and false alarms.</li>' +
      '<li>A quiet country may only be poorly covered by the feeds. Absence of news is not safety.</li>' +
      '<li>Domestic US news is left out on purpose; this tracks international contexts.</li>' +
      '<li>Country detection reads place names and nationalities in headlines. Headlines that name no place are skipped.</li>' +
      '<li>' + (D.baselineReady ? 'Own-baseline comparison is active.' : 'History is still being collected, so levels use the severity rules only until ' + baselineDate() + '.') + '</li></ul>' +
      '<h3>Sources</h3><p>' + D.feeds.ok + ' of ' + D.feeds.total + ' feeds responded on the last refresh. <a href="data/health.json" target="_blank" rel="noopener">Feed health</a> · <a href="data/brief.json" target="_blank" rel="noopener">Raw data</a>.</p>' +
      '<p>This is a demo. <a href="https://github.com/thanizmy/upstream/issues/new?title=Feedback%3A%20&labels=feedback" target="_blank" rel="noopener">Tell us what to fix</a>.</p>';
  }
  function baselineDate() { var d = new Date(D.historySince + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 21); return d.toISOString().slice(0, 10); }

  /* ── events ────────────────────────────────────────── */
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    var d = b.dataset, p, w;
    if (d.unwatch) { w = watchList().list.filter(function (c) { return c !== d.unwatch; }); save(WK, w.length ? w : null); renderAll(); }
    else if (d.watch) { w = watchList().list; if (w.indexOf(d.watch) < 0) w.push(d.watch); save(WK, w); renderAll(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else if (b.id === 'wReset') { save(WK, null); renderAll(); }
    else if (d.addp) { p = pray(); if (p.countries.indexOf(d.addp) < 0) p.countries.push(d.addp); savePray(p); flash(b, 'Added ✓'); }
    else if (d.rmp) { p = pray(); p.countries = p.countries.filter(function (c) { return c !== d.rmp; }); savePray(p); renderPrayer(); }
    else if (d.done) { p = pray(); if (p.done[d.done] === today()) delete p.done[d.done]; else p.done[d.done] = today(); savePray(p); renderPrayer(); }
    else if (d.pin) {
      var e = findEvent(d.pin, d.cc); if (!e) return;
      p = pray(); if (!p.heads.some(function (h) { return h.id === e.id; })) { var c = byCc[d.cc] || {}; p.heads.unshift({ id: e.id, t: e.h, u: e.u, cc: d.cc, c: c.k || e.c, fl: c.fl || e.fl, s: e.s, added: today() }); savePray(p); }
      flash(b, 'Saved ✓');
    }
    else if (d.rmh !== undefined) { p = pray(); p.heads.splice(+d.rmh, 1); savePray(p); renderPrayer(); }
  });
  function flash(b, t) { var o = b.textContent; b.textContent = t; setTimeout(function () { b.textContent = o; }, 1400); }
  function addByName(name) {
    name = (name || '').trim().toLowerCase();
    return D.countries.filter(function (c) { return c.k.toLowerCase() === name; })[0] || null;
  }
  document.addEventListener('change', function (ev) {
    if (ev.target.id === 'wAdd') { var c = addByName(ev.target.value); if (c) { var w = watchList().list; if (w.indexOf(c.cc) < 0) w.push(c.cc); save(WK, w); renderAll(); } }
  });
  $('pcBtn').addEventListener('click', function () {
    var c = addByName($('pcAdd').value); if (!c) { $('pcAdd').focus(); return; }
    var p = pray(); if (p.countries.indexOf(c.cc) < 0) p.countries.push(c.cc); savePray(p); $('pcAdd').value = ''; renderPrayer();
  });
  $('phBtn').addEventListener('click', function () {
    var t = $('phText').value.trim(); if (!t) { $('phText').focus(); return; }
    var p = pray(); p.heads.unshift({ id: 'u' + Date.now(), t: t, u: safeUrl($('phUrl').value.trim()), added: today() }); savePray(p);
    $('phText').value = ''; $('phUrl').value = ''; renderPrayer();
  });
  $('q').addEventListener('input', renderExplore);
  $('region').addEventListener('change', renderExplore);

  function route() {
    var t = (location.hash || '#brief').slice(1); if (['brief', 'prayer', 'about'].indexOf(t) < 0) t = 'brief';
    ['brief', 'prayer', 'about'].forEach(function (k) { $('tab-' + k).hidden = k !== t; });
    document.querySelectorAll('nav a').forEach(function (a) { a.classList.toggle('on', a.dataset.tab === t); });
    if (t === 'prayer') renderPrayer();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  function renderAll() { renderBrief(); renderPrayer(); }
  function boot(data) {
    D = data; D.countries.forEach(function (c) { byCc[c.cc] = c; });
    $('countryList').innerHTML = D.countries.map(function (c) { return '<option value="' + esc(c.k) + '">'; }).join('');
    var regions = {}; D.countries.forEach(function (c) { regions[c.region] = 1; });
    $('region').innerHTML = '<option value="">All regions</option>' + Object.keys(regions).sort().map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('');
    var age = (Date.now() - new Date(D.generated)) / 36e5, bn = $('banner'), msg = '';
    if (age > 12) { msg = 'This data is ' + Math.round(age) + ' hours old; the latest refresh may have failed.'; bn.className = 'banner warn'; }
    else if (!D.baselineReady) { msg = 'Demo note: Upstream is still collecting history. Levels use severity rules only until about ' + baselineDate() + ', after which each country is compared with its own normal.'; }
    if (msg) { bn.textContent = msg; bn.hidden = false; }
    renderBrief(); renderAbout(); route();
  }
  fetch('data/brief.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(boot).catch(function (e) {
    $('heroLine').textContent = 'The brief could not be loaded. Please refresh in a minute.'; $('dateline').textContent = 'Error';
  });
})();
