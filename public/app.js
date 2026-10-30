/* Upstream front end. No build step; reads data/brief.json and data/c/<cc>.json. */
(function () {
  'use strict';
  var BAND = ['', 'Quiet', 'Routine', 'Elevated', 'High', 'Critical'];
  var TH = { conflict: 'Conflict', disaster: 'Disaster', health: 'Health', persecution: 'Persecution', hunger: 'Hunger', displacement: 'Displacement', unrest: 'Unrest', politics: 'Politics', other: 'Other' };
  var WK = 'upstream.watch.v2', PK = 'upstream.pray.v1', VK = 'upstream.view.v1';
  var D, byCc = {}, view = 'w7', world = null, profileCache = {};

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function safeUrl(u) { try { var x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (e) { return ''; } }
  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function today() { return new Date().toISOString().slice(0, 10); }
  function fmt(n) { return n == null ? '—' : Number(n).toLocaleString('en-US'); }
  function ago(d) {
    var n = Math.round((Date.now() - new Date(d + 'T12:00:00Z')) / 864e5);
    return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + 'd ago';
  }
  function shortDate(d) { return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); }
  function kc(n) { return 'var(--s' + Math.max(1, Math.min(5, n || 1)) + ')'; }
  function pips(n) {
    var h = ''; for (var i = 1; i <= 5; i++) h += '<i class="' + (i <= n ? 'on' : '') + '"></i>';
    return '<span class="pips" style="--k:' + kc(n) + '" title="severity ' + n + ' of 5">' + h + '</span>';
  }
  var LANGN = { es: 'Spanish', fr: 'French', pt: 'Portuguese', de: 'German', ru: 'Russian or Ukrainian', id: 'Indonesian', tr: 'Turkish', sw: 'Swahili', ar: 'Arabic' };
  function lang(l) { return l && l !== 'en' ? '<span class="tag lang" title="Local-language headline, ' + (LANGN[l] || l) + '">' + l.toUpperCase() + ' · local</span>' : ''; }
  function tag(t, quiet) { return t ? '<span class="tag' + (quiet ? ' q' : '') + '">' + esc(t) + '</span>' : ''; }
  function bandChip(n) { return '<span class="band" data-b="' + n + '" style="--k:' + kc(n) + '">' + BAND[n] + '</span>'; }
  function fmtDate(iso) { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
  function winLabel() { return view === 'w7' ? 'last 7 days' : 'last 30 days'; }
  function W(c) { return c[view]; }
  function chgHtml(w) {
    var t = w.chg;
    if (!t) return '<span class="flat" title="Needs more history">building</span>';
    var basis = { week: 'vs last week', '3d': 'last 3d vs prior 4d', '15d': 'last 15d vs prior 15d' }[t.basis] || '';
    if (t.dir === 'up') return '<span class="up" title="' + basis + '">&#9650; ' + (t.pct == null ? 'new' : (t.pct > 500 ? '500%+' : t.pct + '%')) + '</span>';
    if (t.dir === 'down') return '<span class="down" title="' + basis + '">&#9660; ' + Math.abs(t.pct) + '%</span>';
    return '<span class="flat" title="' + basis + '">flat</span>';
  }
  function chgLong(w) {
    var t = w.chg; if (!t) return '<span class="flat">change shows once more history exists</span>';
    var basis = { week: 'vs last week', '3d': 'last 3 days vs the 4 before', '15d': 'last 15 days vs the 15 before' }[t.basis];
    if (t.dir === 'up') return '<span class="up">&#9650; ' + (t.pct == null ? 'new activity' : (t.pct > 500 ? '500%+' : t.pct + '%')) + '</span> ' + basis;
    if (t.dir === 'down') return '<span class="down">&#9660; ' + Math.abs(t.pct) + '%</span> ' + basis;
    return '<span class="flat">flat</span> ' + basis;
  }

  /* tooltip */
  var tip = $('tip');
  function showTip(e, h) { tip.innerHTML = h; tip.style.opacity = 1; var x = Math.min(e.clientX + 14, innerWidth - 270); tip.style.left = x + 'px'; tip.style.top = (e.clientY + 16) + 'px'; }
  function hideTip() { tip.style.opacity = 0; }

  /* ── state ─────────────────────────────────────────── */
  function watchList() {
    var w = load(WK, null);
    if (Array.isArray(w) && w.length) return { list: w.filter(function (c) { return byCc[c]; }), custom: true };
    return { list: D.top5.slice(), custom: false };
  }
  function pray() { var p = load(PK, {}); return { countries: p.countries || [], heads: p.heads || [], done: p.done || {} }; }
  function savePray(p) { save(PK, p); }

  /* ── shared pieces ─────────────────────────────────── */
  function spark(c, big) {
    var S = c.series, n0 = S.n.length, from = view === 'w7' && !big ? n0 - 14 : 0;
    var N = S.n.slice(from), SV = S.s.slice(from), days = from ? 14 : n0;
    var Wd = 320, H = big ? 120 : 46, n = N.length, gap = 2, bw = (Wd - (n - 1) * gap) / n, mx = Math.max.apply(null, N) || 1, b = '';
    for (var i = 0; i < n; i++) {
      var h = N[i] ? Math.max(3, N[i] / mx * (H - 3)) : 0;
      var dt = new Date(Date.now() - (n - 1 - i) * 864e5).toISOString().slice(5, 10);
      b += '<rect x="' + (i * (bw + gap)).toFixed(1) + '" y="' + (H - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" style="--k:' + kc(SV[i]) + '"><title>' + dt + ': ' + N[i] + ' event' + (N[i] === 1 ? '' : 's') + '</title></rect>';
    }
    return '<svg class="spark' + (big ? ' big' : '') + '" viewBox="0 0 ' + Wd + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Events per day, last ' + days + ' days">' + b + '<line class="base" x1="0" y1="' + H + '" x2="' + Wd + '" y2="' + H + '"/></svg>' +
      '<span class="sparkcap"><span>' + days + ' days ago</span><span>' + mx + ' peak</span><span>today</span></span>';
  }
  function evRow(e, c, withPray) {
    var u = safeUrl(e.u);
    return '<div class="urow"><span>' + pips(e.s) + '</span>' +
      '<a class="ev" href="' + esc(u) + '" target="_blank" rel="noopener"><span class="h">' + esc(e.h) + '</span>' +
      '<span class="m">' + lang(e.l) + tag(TH[e.th]) + tag(e.o + ' outlet' + (e.o > 1 ? 's' : ''), 1) + '<span class="mt">' + esc(e.src) + ' · ' + ago(e.d) + '</span></span></a>' +
      '<span></span></div>';
  }
  function countryCard(c, o) {
    o = o || {};
    var w = W(c), done = pray().done[c.cc] === today();
    return '<article class="card" style="--k:' + kc(w.band) + '"><h3><span class="fl">' + c.fl + '</span><a class="cl" href="#c/' + c.cc + '">' + esc(c.k) + '</a>' + bandChip(w.band) + '</h3>' +
      '<p class="stats"><span class="lab">Summary</span><b>' + w.ev + '</b> events · ' + w.rep + ' reports · ' + w.src + ' outlets · ' + chgHtml(w) + (w.thin ? ' <span class="thin">thin coverage</span>' : '') + '</p>' +
      spark(c) +
      '<div class="prayer">' + esc(c.prayer.text) + '</div>' +
      '<div>' + w.top.slice(0, o.events || 2).map(function (e) { return evRow(e, c, true); }).join('') + '</div>' +
      '<div class="acts"><a class="btn ghost" href="#c/' + c.cc + '">Full report</a>' +
      (o.prayed ? '<button class="btn ' + (done ? 'done' : '') + '" data-done="' + c.cc + '" type="button">' + (done ? 'Prayed today ✓' : 'Mark as prayed') + '</button>' : '<button class="btn ghost" data-addp="' + c.cc + '" type="button">Add to prayer space</button>') +
      (o.remove ? '<button class="btn ghost" data-' + o.remove + '="' + c.cc + '" type="button">Remove</button>' : '') +
      '</div></article>';
  }
  function findEvent(id, cc) {
    var c = byCc[cc]; if (c) { var e = c.w7.top.concat(c.w30.top).filter(function (x) { return x.id === id; })[0]; if (e) return e; }
    var u = D.urgent.w7.concat(D.urgent.w30).filter(function (x) { return x.id === id; })[0]; if (u) return u;
    var s = D.stories.w7.concat(D.stories.w30).filter(function (x) { return x.id === id; })[0]; return s || null;
  }
  function urgentRow(u) {
    var url = safeUrl(u.u), c = byCc[u.cc] || { cc: u.cc };
    return '<div class="urow"><span>' + pips(u.s) + '</span><a class="ev" href="' + esc(url) + '" target="_blank" rel="noopener"><span class="h">' + esc(u.h) + '</span>' +
      '<span class="m">' + lang(u.l) + tag(TH[u.th]) + tag(u.o + ' outlets', 1) + '<span class="mt">' + u.fl + ' ' + esc(u.c) + ' · ' + ago(u.d) + '</span></span></a><span></span></div>';
  }

  /* ── brief ─────────────────────────────────────────── */
  function renderHero() {
    var k = D.kpi[view], isW = view === 'w7';
    $('dateline').textContent = 'Situation brief · updated ' + fmtDate(D.generated) + ' · ' + D.feeds.ok + ' of ' + D.feeds.total + ' sources live';
    $('heroLine').innerHTML = '<b>' + k.hot + '</b> of ' + k.watched + ' countries with reporting are at High or Critical in the ' + winLabel() + '. <b>' + k.urgent + '</b> confirmed serious events ' + (isW ? 'landed in the last 72 hours' : 'happened this month') + '. Your countries come first.';
    $('kpis').innerHTML = [
      ['Countries with reporting', fmt(k.watched)], ['At High or Critical', fmt(k.hot)], ['Live sources', fmt(D.feeds.ok)],
      ['Reports, ' + winLabel(), fmt(k.reports)], ['Serious events' + (isW ? ', 72h' : ', 30d'), fmt(k.urgent)], ['Held for one source', fmt(k.held)]
    ].map(function (r) { return '<div class="kpi"><b>' + r[1] + '</b><span>' + r[0] + '</span></div>'; }).join('');
    document.querySelectorAll('.seg button').forEach(function (b) { b.classList.toggle('on', b.dataset.view === view); b.setAttribute('aria-pressed', b.dataset.view === view); });
    $('viewNote').textContent = isW ? 'Showing the last 7 days' : 'Showing the last 30 days' + (D.spanDays < 28 ? ' · history is still building (' + D.spanDays + ' days collected)' : '');
  }
  function renderWatch() {
    var w = watchList();
    $('watchMode').textContent = w.custom ? 'Your own list, saved on this device' : 'Default: the five most urgent right now';
    $('chips').innerHTML = w.list.map(function (cc) {
      var c = byCc[cc]; return '<span class="chip">' + c.fl + ' ' + esc(c.k) + '<button type="button" data-unwatch="' + cc + '" aria-label="Remove ' + esc(c.k) + '">&times;</button></span>';
    }).join('') + '<input type="search" id="wAdd" list="countryList" placeholder="Add a country…" aria-label="Add a country to your list" autocomplete="off">' +
      (w.custom ? '<button class="linkbtn" type="button" id="wReset">Reset to top 5 most urgent</button>' : '');
    $('watch').innerHTML = w.list.map(function (cc) { return countryCard(byCc[cc], { events: 2 }); }).join('');
  }
  function renderUrgent() {
    var w = watchList(), set = {}; w.list.forEach(function (c) { set[c] = 1; });
    var U = D.urgent[view], mine = U.filter(function (u) { return set[u.cc]; }), other = U.filter(function (u) { return !set[u.cc]; });
    $('urgentCount').textContent = (view === 'w7' ? 'last 72 hours · ' : 'last 30 days · ') + mine.length + ' in your countries · ' + other.length + ' elsewhere';
    $('urgentMine').innerHTML = mine.length ? mine.map(urgentRow).join('') : '<div class="empty">Nothing at severity 4 or above, confirmed by two sources, in your countries in this window. That is a real reading, not an empty feed.</div>';
    $('urgentOtherLabel').textContent = 'Elsewhere in the world (' + other.length + ')';
    $('urgentOther').innerHTML = other.map(urgentRow).join('');
    $('urgentOtherWrap').hidden = !other.length;
  }
  function renderMoved() {
    var M = D.moved[view];
    $('movedH').innerHTML = 'What <i>moved</i> ' + (view === 'w7' ? 'this week' : 'this month');
    if (!M) { $('movedBasis').textContent = ''; $('moved').innerHTML = '<div class="empty list">Monthly movement compares the last 15 days with the 15 before. It appears once Upstream has 28 days of history (' + D.spanDays + ' so far). Switch to Weekly to see movement now.</div>'; return; }
    $('movedBasis').textContent = M.basis;
    function rows(arr, cls) {
      return arr.length ? arr.map(function (r) {
        return '<a class="mv" href="#c/' + r.cc + '"><span><span class="fl">' + (r.fl || '') + '</span> <b>' + esc(r.k) + '</b></span><span class="' + cls + '">' + ((r.isNew ? 'new' : (r.pct > 500 ? '500%+' : (r.pct > 0 ? '+' : '') + r.pct + '%'))) + '</span></a>';
      }).join('') : '<p class="flat" style="margin:10px 0 0">None this period.</p>';
    }
    var th = M.themes.length ? M.themes.map(function (t) {
      var up = t.pct == null || t.pct > 0;
      return '<a class="mv"><span><b>' + esc(TH[t.th] || t.th) + '</b> <span class="flat">· ' + t.cur + ' a day</span></span><span class="' + (up ? 'up' : 'down') + '">' + (t.pct == null ? 'new' : (t.pct > 0 ? '+' : '') + (Math.abs(t.pct) > 500 ? '500+' : t.pct) + '%') + '</span></a>';
    }).join('') : '<p class="flat" style="margin:10px 0 0">No theme moved sharply.</p>';
    var sud = M.sudden.length ? M.sudden.map(function (e) {
      return '<a class="mv sd" href="' + esc(safeUrl(e.u)) + '" target="_blank" rel="noopener"><span><span class="fl">' + e.fl + '</span> <b>' + esc(e.c) + '</b><br><span class="flat">' + esc(e.h) + '</span></span>' + pips(e.s) + '</a>';
    }).join('') : '<p class="flat" style="margin:10px 0 0">No new serious events in the last 48 hours.</p>';
    $('moved').innerHTML = '<div class="cells c2"><div class="cell"><span class="k">Rising fastest</span>' + rows(M.up, 'up') + '</div>' +
      '<div class="cell"><span class="k">Quietening</span>' + rows(M.down, 'down') + '</div>' +
      '<div class="cell"><span class="k">Sudden: new serious events, last 48 hours</span>' + sud + '</div>' +
      '<div class="cell"><span class="k">Themes shifting</span>' + th + '</div></div>';
  }
  function renderStories() {
    var S = D.stories[view];
    $('storiesNote').textContent = 'Ranked by seriousness · two or more outlets';
    $('stories').innerHTML = S.map(function (s, i) {
      var img = safeUrl(s.img);
      return '<a class="topc" href="' + esc(safeUrl(s.u)) + '" target="_blank" rel="noopener">' +
        (img ? '<img src="' + esc(img) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">' : '') +
        '<div class="b"><span class="num">0' + (i + 1) + '</span><h4>' + esc(s.h) + '</h4>' +
        '<p class="k">' + lang(s.l) + tag(TH[s.th]) + tag(s.o + ' outlets', 1) + '<span class="mt">' + s.fl + ' ' + esc(s.c) + ' · ' + ago(s.d) + '</span></p>' + pips(s.s) + '</div></a>';
    }).join('') || '<div class="empty">No story has two independent outlets in this window yet.</div>';
  }
  function tipFor(c) {
    var w = W(c);
    return '<b>' + c.fl + ' ' + esc(c.k) + '</b><br>' + BAND[w.band] + ' · ' + w.ev + ' events · ' + w.rep + ' reports' + (w.chg && w.chg.pct != null ? '<br>' + (w.chg.pct > 0 ? '+' : '') + w.chg.pct + '% change' : '') + '<br><i>Select for full report</i>';
  }
  function renderMap() {
    if (!world) return;
    var ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + world.w + ' ' + world.h); svg.setAttribute('class', 'mapsvg'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'World map. Countries are filled by level; select one to open its report.');
    var html = '';
    for (var lo = -150; lo <= 180; lo += 30) { var x = ((lo + 180) / 360 * world.w).toFixed(1); html += '<line class="gridline" x1="' + x + '" x2="' + x + '" y1="0" y2="' + world.h + '"/>'; }
    var data = {}; D.countries.forEach(function (c) { data[c.cc] = c; });
    Object.keys(world.paths).forEach(function (cc) {
      var c = data[cc], w = c && W(c);
      html += '<path d="' + world.paths[cc] + '" class="land' + (c ? ' has' : '') + '"' + (c ? ' data-cc="' + cc + '" style="--k:' + kc(w.band) + '" tabindex="0" role="link" aria-label="' + esc(c.k) + ', ' + BAND[w.band] + '"' : '') + '/>';
    });
    var mx = Math.max.apply(null, D.countries.map(function (c) { return W(c).ev; })) || 1;
    D.countries.forEach(function (c) {
      var d = world.paths[c.cc]; if (d && d.length > 160) return; // big enough to click as a shape
      var w = W(c); if (!c.ll || !w.ev) return;
      var cx = (c.ll[1] + 180) / 360 * world.w, cy = (84 - c.ll[0]) / 142 * world.h, r = 3 + Math.sqrt(w.ev / mx) * 9;
      html += '<circle class="dot" data-cc="' + c.cc + '" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r.toFixed(1) + '" style="--k:' + kc(w.band) + '"/>';
    });
    svg.innerHTML = html;
    $('map').innerHTML = ''; $('map').appendChild(svg);
    svg.addEventListener('mousemove', function (e) { var t = e.target.closest('[data-cc]'); if (t && byCc[t.dataset.cc]) showTip(e, tipFor(byCc[t.dataset.cc])); else hideTip(); });
    svg.addEventListener('mouseleave', hideTip);
    svg.addEventListener('click', function (e) { var t = e.target.closest('[data-cc]'); if (t) location.hash = '#c/' + t.dataset.cc; });
    svg.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var t = e.target.closest('[data-cc]'); if (t) location.hash = '#c/' + t.dataset.cc; } });
    var placed = D.countries.filter(function (c) { return W(c).ev; }).length;
    $('mapStat').textContent = placed + ' countries with reports · ' + winLabel();
    $('maplegend').innerHTML = [1, 2, 3, 4, 5].map(function (b) { return '<b><i style="--k:' + kc(b) + '"></i>' + BAND[b] + '</b>'; }).join('') + '<b><i style="--k:var(--sink);outline:1px solid var(--rule)"></i>Not tracked (incl. US)</b><b style="margin-left:auto">dots mark small countries · size = events</b>';
    // regional data table
    var R = {}; D.countries.forEach(function (c) { var w = W(c); if (!w.ev) return; var r = R[c.region] = R[c.region] || { n: 0, hot: 0, ev: 0, rep: 0 }; r.n++; r.ev += w.ev; r.rep += w.rep; if (w.band >= 4) r.hot++; });
    $('regions').innerHTML = '<thead><tr><th>Region</th><th class="n">Countries</th><th class="n">High or Critical</th><th class="n">Events</th><th class="n">Reports</th></tr></thead><tbody>' +
      Object.keys(R).sort(function (a, b) { return R[b].hot - R[a].hot || R[b].ev - R[a].ev; }).map(function (k) {
        var r = R[k]; return '<tr><td><span class="cn">' + esc(k) + '</span></td><td class="n">' + r.n + '</td><td class="n"><b>' + r.hot + '</b></td><td class="n">' + r.ev + '</td><td class="n">' + r.rep + '</td></tr>';
      }).join('') + '</tbody>';
  }
  function renderNeed() {
    var q = $('q').value.trim().toLowerCase(), r = $('region').value, s = $('sort').value;
    var rows = D.countries.filter(function (c) { return W(c).ev && (!q || c.k.toLowerCase().indexOf(q) >= 0) && (!r || c.region === r); });
    var by = {
      rank: function (a, b) { return W(a).rank - W(b).rank; },
      gap: function (a, b) { return (W(b).band >= 3) - (W(a).band >= 3) || W(b).band - W(a).band + (W(a).src - W(b).src) * 0.01 || W(a).src - W(b).src; },
      reports: function (a, b) { return W(b).rep - W(a).rep; },
      az: function (a, b) { return a.k.localeCompare(b.k); }
    };
    if (s === 'gap') rows.sort(function (a, b) { var ga = W(a).band >= 3 ? 0 : 1, gb = W(b).band >= 3 ? 0 : 1; return ga - gb || W(a).src - W(b).src || W(b).band - W(a).band; });
    else rows.sort(by[s]);
    $('needStat').textContent = rows.length + ' countries · first 10 shown, scroll for more';
    $('need').innerHTML = '<thead><tr><th>Country</th><th>Level</th><th class="n">Events</th><th class="n">Reports</th><th class="n">Our sources</th><th>Change</th></tr></thead><tbody>' +
      rows.map(function (c) {
        var w = W(c);
        return '<tr class="go" data-go="' + c.cc + '" tabindex="0"><td><span class="cn"><span class="fl">' + c.fl + '</span>' + esc(c.k) + (w.thin ? '<span class="thin">thin</span>' : '') + '</span></td>' +
          '<td>' + pips(w.band) + ' <span class="lv">' + BAND[w.band] + '</span></td><td class="n">' + w.ev + '</td><td class="n">' + w.rep + '</td><td class="n">' + w.src + '</td><td>' + chgHtml(w) + '</td></tr>';
      }).join('') + '</tbody>';
  }
  function renderGaps() {
    var k = D.kpi[view];
    var g = [['Held for one source', fmt(k.held), 'Serious events carried by only one outlet are not listed as urgent or as top stories. Persecution reporting is often single-sourced, so this number reflects the beat as much as the feeds.'],
      ['Thinly covered', fmt(D.gaps.length), 'Countries at High or Critical where two or fewer outlets report. The level may be understated or overstated; treat these as places to look harder.'],
      ['Verified by a person', '0', 'Nothing here is confirmed by a human. Counting outlets measures how mainstream a story is, not whether it is true.']];
    $('gaps').innerHTML = g.map(function (r) { return '<div class="cell"><span class="k">' + r[0] + '</span><h3>' + r[1] + '</h3><p>' + r[2] + '</p></div>'; }).join('');
    $('gapChips').innerHTML = D.gaps.map(function (cc) { var c = byCc[cc]; return '<a class="chip" href="#c/' + cc + '">' + c.fl + ' ' + esc(c.k) + '</a>'; }).join('');
  }
  function renderMethod() {
    var m = [['Sources', fmt(D.feeds.total), 'Public news, humanitarian and faith feeds, in English and in local languages (' + (D.feeds.langs || ['en']).length + ' languages, ' + (D.feeds.local || 0) + ' local-language feeds). A feed enters only if it parses and published within 45 days. ' + D.feeds.ok + ' responded on the last refresh.'],
      ['Window', view === 'w7' ? '7 days' : '30 days', fmt(D.tracked) + ' tagged reports are held. Nothing older is substituted to pad a short list.'],
      ['Level', 'unique events', 'Reports about one incident count once; events weigh 1, 3, 9, 27 or 81 by severity; each country is read against its own history once three weeks exist.']];
    $('method').innerHTML = m.map(function (r) { return '<div class="cell"><span class="k">' + r[0] + '</span><h3>' + r[1] + '</h3><p>' + r[2] + '</p></div>'; }).join('');
  }
  function renderBrief() {
    renderHero(); renderWatch(); renderUrgent(); renderMoved(); renderStories(); renderMap(); renderNeed(); renderGaps(); renderMethod();
  }

  /* ── country profile ───────────────────────────────── */
  function renderProfile(cc) {
    var c = byCc[cc], el = $('profile');
    if (!c) { el.innerHTML = '<div class="hero"><p class="eyebrow">Country</p><h1>No recent reports for this country.</h1><p><a class="btn ghost" href="#brief">Back to the brief</a></p></div>'; return; }
    var w7 = c.w7, w30 = c.w30, w = W(c), inPray = pray().countries.indexOf(cc) >= 0, followed = watchList().list.indexOf(cc) >= 0;
    el.innerHTML = '<div class="hero"><p class="eyebrow"><a href="#brief">← Brief</a> · Country report · ' + esc(c.region) + '</p>' +
      '<h1><span class="fl big">' + c.fl + '</span> ' + esc(c.k) + '</h1>' +
      '<div class="acts" style="margin-top:20px"><button class="btn" data-addp="' + cc + '" type="button">' + (inPray ? 'In my prayer space ✓' : 'Add to my prayer space') + '</button>' +
      '<button class="btn ghost" data-watch="' + cc + '" type="button">' + (followed ? 'Following ✓' : 'Follow in my brief') + '</button></div></div>' +
      '<div class="sechead"><h2>Report <i>summary</i></h2><span class="sub">' + winLabel() + ' · switch with Weekly / Monthly above</span></div>' +
      '<div class="cells c3 prof">' +
      '<div class="cell"><span class="k">Level</span><h3>' + BAND[w.band] + '</h3><p>' + pips(w.band) + ' Rank ' + w.rank + ' of ' + D.countries.length + '</p></div>' +
      '<div class="cell"><span class="k">Events · reports</span><h3>' + w.ev + ' · ' + w.rep + '</h3><p>' + w7.ev + ' in 7 days, ' + w30.ev + ' in 30 days</p></div>' +
      '<div class="cell"><span class="k">Outlets · peak severity</span><h3>' + w.src + ' · ' + w.maxSev + '</h3><p>' + (w.thin ? '<span class="thin">thin coverage</span> ' : '') + 'Distinct outlets reporting</p></div>' +
      '</div>' +
      '<p class="lede" id="pSummary"></p>' +
      '<div class="prayer big">' + esc(c.prayer.text) + '</div>' +
      '<div class="sechead"><h2>Activity, <i>day by day</i></h2><span class="sub">' + chgLong(w) + '</span></div>' +
      '<div class="panelbox">' + spark(c, true) + '</div>' +
      '<div class="sevbar" id="sevbar"></div><div id="themes" class="chips"></div>' +
      '<div class="sechead"><h2>Urgent <i>history</i></h2><span class="sub" id="uhSub">Loading…</span></div><div class="list" id="uh"></div>' +
      '<div class="sechead"><h2>All <i>reports</i></h2><span class="sub" id="arSub"></span></div>' +
      '<div class="filters"><select id="fSev" aria-label="Minimum severity"><option value="0">All severities</option><option value="3">Severity 3 and up</option><option value="4">Severity 4 and up</option></select>' +
      '<select id="fTh" aria-label="Theme"><option value="">All themes</option></select><select id="fWin" aria-label="Period"><option value="40">Everything held</option><option value="30">Last 30 days</option><option value="7">Last 7 days</option></select></div>' +
      '<div class="list scrollbox tall" id="reports"></div>' +
      '<p class="note">Reports at severity 1 are not stored. Headlines link to the publisher; Upstream does not reproduce articles.</p>';
    // chart severity bar + themes from window stats
    var tot = w.sev.reduce(function (a, b) { return a + b; }, 0) || 1;
    $('sevbar').innerHTML = '<span class="k">Events by severity, ' + winLabel() + '</span><div class="bar">' + w.sev.map(function (n, i) { return n ? '<i style="flex:' + n + ';background:' + kc(i + 1) + '" title="severity ' + (i + 1) + ': ' + n + '"></i>' : ''; }).join('') + '</div><div class="legend">' +
      w.sev.map(function (n, i) { return '<span><i style="background:' + kc(i + 1) + '"></i>' + (i + 1) + ': <b>' + n + '</b></span>'; }).join('') + '</div>';
    $('themes').innerHTML = Object.keys(w.th).sort(function (a, b) { return w.th[b] - w.th[a]; }).map(function (t) { return '<span class="chip">' + esc(TH[t] || t) + ' <b>' + w.th[t] + '</b></span>'; }).join('');
    // narrative
    var top = w.top[0], themes = Object.keys(w.th).sort(function (a, b) { return w.th[b] - w.th[a]; });
    var serious = (w.sev[3] || 0) + (w.sev[4] || 0);
    $('pSummary').innerHTML = 'In the ' + winLabel() + ', Upstream tracked <b>' + w.ev + '</b> unique events in ' + esc(c.k) + ' from <b>' + w.src + '</b> outlets, <b>' + serious + '</b> of them serious (severity 4 or 5). ' +
      (top ? 'The most serious is “' + esc(top.h) + '” (' + esc(top.src) + ', ' + top.o + ' outlet' + (top.o > 1 ? 's' : '') + '). ' : '') +
      (themes.length ? 'Most events concern ' + esc((TH[themes[0]] || themes[0]).toLowerCase()) + (themes[1] ? ', then ' + esc((TH[themes[1]] || themes[1]).toLowerCase()) : '') + '. ' : '') +
      (w.thin ? 'Coverage is thin, so treat this level with caution.' : '');
    var sel = $('fTh'); Object.keys(w30.th).concat(Object.keys(w7.th)).filter(function (t, i, a) { return a.indexOf(t) === i; }).forEach(function (t) { sel.insertAdjacentHTML('beforeend', '<option value="' + t + '">' + esc(TH[t] || t) + '</option>'); });
    loadProfile(cc);
  }
  function loadProfile(cc) {
    function go(P) {
      var all = [];
      P.events.forEach(function (e) { e.items.forEach(function (it) { all.push({ t: it.t, u: it.u, f: it.f, d: it.d, s: it.s, th: e.th, n: e.r, eid: e.id }); }); });
      all.sort(function (a, b) { return a.d < b.d ? 1 : a.d > b.d ? -1 : b.s - a.s; });
      var urgent = P.events.filter(function (e) { return e.s >= 4; });
      $('uhSub').textContent = urgent.length + ' serious events in the data we hold';
      $('uh').innerHTML = urgent.length ? urgent.map(function (e) {
        return '<div class="urow"><span>' + pips(e.s) + '</span><a class="ev" href="' + esc(safeUrl(e.u)) + '" target="_blank" rel="noopener"><span class="h">' + esc(e.h) + '</span><span class="m">' + lang(e.l) + shortDate(e.d) + (e.last !== e.d ? ' to ' + shortDate(e.last) : '') + ' · ' + esc(TH[e.th] || '') + ' · ' + e.o + ' outlet' + (e.o > 1 ? 's' : '') + ' · ' + e.r + ' report' + (e.r > 1 ? 's' : '') + '</span></a><span></span></div>';
      }).join('') : '<div class="empty">No serious events in the data we hold for this country.</div>';
      P._ev = {}; P.events.forEach(function (e) { P._ev[e.id] = e; });
      function draw() {
        var ms = +$('fSev').value, th = $('fTh').value, days = +$('fWin').value, cut = Date.now() - days * 864e5;
        var rows = all.filter(function (r) { return r.s >= ms && (!th || r.th === th) && new Date(r.d + 'T12:00:00Z') >= cut; });
        $('arSub').textContent = rows.length + ' of ' + all.length + ' reports';
        $('reports').innerHTML = rows.length ? rows.map(function (r) {
          return '<div class="urow"><span>' + pips(r.s) + '</span><a class="ev" href="' + esc(safeUrl(r.u)) + '" target="_blank" rel="noopener"><span class="h">' + esc(r.t) + '</span><span class="m">' + lang(r.l) + tag(TH[r.th]) + (r.n > 1 ? tag('1 of ' + r.n + ' on this event', 1) : '') + '<span class="mt">' + esc(r.f) + ' · ' + shortDate(r.d) + '</span></span></a><span></span></div>';
        }).join('') : '<div class="empty">No reports match these filters.</div>';
      }
      ['fSev', 'fTh', 'fWin'].forEach(function (id) { $(id).addEventListener('change', draw); });
      draw();
      profileCache[cc] = P;
    }
    if (profileCache[cc]) return go(profileCache[cc]);
    fetch('data/c/' + cc + '.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(go).catch(function () {
      $('uhSub').textContent = ''; $('reports').innerHTML = '<div class="empty">The detailed reports could not be loaded.</div>';
    });
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
      return html.replace('</h3>', '<small class="sub"> ' + (tag[cc] === 'following' ? 'following' : 'added by you') + '</small></h3>');
    }).join('') || '<div class="empty">No countries yet. Add one above, or follow countries from the Brief and they will appear here automatically.</div>';
    $('phSub').textContent = p.heads.length ? p.heads.length + ' saved' : '';
    $('pheads').innerHTML = p.heads.map(function (h, i) {
      var u = safeUrl(h.u || '');
      return '<div class="urow"><span>' + (h.s ? pips(h.s) : '') + '</span><div class="ev"><span class="h">' + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(h.t) + '</a>' : esc(h.t)) + '</span>' +
        '<span class="m">' + (h.fl ? h.fl + ' ' + esc(h.c) + ' · ' : '') + 'saved ' + ago(h.added) + '</span></div><button class="linkbtn" data-rmh="' + i + '" type="button">Remove</button></div>';
    }).join('') || '<div class="empty">Nothing saved. Write your own request above, or add a country to follow its updates.</div>';
  }

  /* ── about ─────────────────────────────────────────── */
  function baselineDate() { var d = new Date(D.historySince + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 21); return d.toISOString().slice(0, 10); }
  function renderAbout() {
    $('aboutBody').innerHTML =
      '<p>Upstream gives international ministry staff a quick read on the countries they serve: what is urgent, what is changing, and what to pray for. It reads public RSS and Atom feeds from ' + D.feeds.total + ' news, humanitarian and faith outlets, including local-language outlets in Spanish, French, Portuguese, Arabic, Russian, German, Indonesian, Turkish and Swahili, and refreshes about every three hours.</p>' +
      '<h3>How a country gets its level</h3><ol>' +
      '<li><b>Unique events, not articles.</b> Reports about the same incident are grouped into one event, so a country with 100 articles on one flood does not outrank a country with one new crisis.</li>' +
      '<li><b>Urgency-weighted.</b> An event counts 1, 3, 9, 27 or 81 by severity (1 to 5). One severity-5 event outweighs ten severity-2 events. A single-source event is capped at severity 4.</li>' +
      '<li><b>Compared with the country itself.</b> Once about three weeks of history exist, each country is compared with its own recent weeks, so ordinarily busy countries are not flagged just for being busy.</li></ol>' +
      '<table><tr><th>Level</th><th>Weekly rule</th></tr><tr><td>Critical</td><td>A severity-5 event confirmed by two sources, or far above its own normal</td></tr><tr><td>High</td><td>A severity-4 event, or well above its normal</td></tr><tr><td>Elevated</td><td>Three or more severity-3 events, or above its normal</td></tr><tr><td>Routine</td><td>Some reporting, nothing serious</td></tr><tr><td>Quiet</td><td>No recent reporting</td></tr></table>' +
      '<p>The monthly view uses higher bars, because over 30 days almost every country has one bad day: High needs two serious events, Critical a confirmed severity-5 event plus two more serious ones.</p>' +
      '<h3>Weekly and monthly</h3><p>Use the Weekly / Monthly switch at the top of the Brief. Monthly figures cover the last 30 days. Upstream began collecting ' + esc(D.historySince) + ', so 30-day change and the own-baseline comparison fill in over time.</p>' +
      '<h3>Your countries and the default five</h3><p>Until you pick your own list, the top shows the five most urgent countries at the moment you open it. Your list and prayer space are stored in this browser only.</p>' +
      '<h3>What it cannot do</h3><ul><li>Severity comes from keyword rules, not a person reading the story. Expect misses and false alarms.</li>' +
      '<li>Local-language headlines are shown as written, tagged with their language, and are not machine-translated. They are grouped only with other headlines in the same language, so one incident covered in two languages can count as two events.</li>' +
      '<li>A quiet country may only be poorly covered by the feeds. Absence of news is not safety.</li>' +
      '<li>Domestic US news is left out on purpose; this tracks international contexts.</li>' +
      '<li>Country detection reads place names and nationalities in headlines. Headlines that name no place are skipped.</li>' +
      '<li>' + (D.baselineReady ? 'Own-baseline comparison is active.' : 'History is still being collected, so levels use the severity rules only until about ' + baselineDate() + '.') + '</li></ul>' +
      '<h3>Sources</h3><p>' + D.feeds.ok + ' of ' + D.feeds.total + ' feeds responded on the last refresh. <a href="data/health.json" target="_blank" rel="noopener">Feed health</a> · <a href="data/brief.json" target="_blank" rel="noopener">Raw data</a> · <a href="https://github.com/thanizmy/upstream" target="_blank" rel="noopener">Code</a>.</p>' +
      '<p>This is a demo. <a href="https://github.com/thanizmy/upstream/issues/new?title=Feedback%3A%20&labels=feedback" target="_blank" rel="noopener">Tell us what to fix</a>.</p>';
  }

  /* ── events ────────────────────────────────────────── */
  document.addEventListener('click', function (ev) {
    var row = ev.target.closest('tr[data-go]');
    if (row && !ev.target.closest('a')) { location.hash = '#c/' + row.dataset.go; return; }
    var seg = ev.target.closest('.seg button');
    if (seg) { view = seg.dataset.view; save(VK, view); refreshAll(); return; }
    var b = ev.target.closest('button'); if (!b) return;
    var d = b.dataset, p, w;
    if (d.unwatch) { w = watchList().list.filter(function (c) { return c !== d.unwatch; }); save(WK, w.length ? w : null); refreshAll(); }
    else if (d.watch) { w = watchList().list; var i = w.indexOf(d.watch); if (i < 0) w.push(d.watch); else w.splice(i, 1); save(WK, w.length ? w : null); refreshAll(); }
    else if (b.id === 'wReset') { save(WK, null); refreshAll(); }
    else if (d.addp) { p = pray(); var j = p.countries.indexOf(d.addp); if (j < 0) { p.countries.push(d.addp); flash(b, 'Added ✓'); } else { flash(b, 'Already added'); } savePray(p); if (location.hash.indexOf('#c/') === 0) setTimeout(route, 1200); }
    else if (d.rmp) { p = pray(); p.countries = p.countries.filter(function (c) { return c !== d.rmp; }); savePray(p); renderPrayer(); }
    else if (d.done) { p = pray(); if (p.done[d.done] === today()) delete p.done[d.done]; else p.done[d.done] = today(); savePray(p); renderPrayer(); }
    else if (d.pin) {
      var e = findEvent(d.pin, d.cc);
      if (!e && d.ph && profileCache[d.cc]) { var pe = profileCache[d.cc]._ev[d.pin]; if (pe) e = { id: pe.id, h: pe.h, u: pe.u, s: pe.s }; }
      if (!e) return;
      p = pray(); if (!p.heads.some(function (h) { return h.id === e.id; })) { var c = byCc[d.cc] || {}; p.heads.unshift({ id: e.id, t: e.h, u: e.u, cc: d.cc, c: c.k || e.c, fl: c.fl || e.fl, s: e.s, added: today() }); savePray(p); }
      flash(b, 'Saved ✓');
    }
    else if (d.rmh !== undefined) { p = pray(); p.heads.splice(+d.rmh, 1); savePray(p); renderPrayer(); }
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { var row = ev.target.closest && ev.target.closest('tr[data-go]'); if (row) location.hash = '#c/' + row.dataset.go; } });
  function flash(b, t) { var o = b.textContent; b.textContent = t; setTimeout(function () { b.textContent = o; }, 1400); }
  function addByName(name) { name = (name || '').trim().toLowerCase(); return D.countries.filter(function (c) { return c.k.toLowerCase() === name; })[0] || null; }
  document.addEventListener('change', function (ev) {
    if (ev.target.id === 'wAdd') { var c = addByName(ev.target.value); if (c) { var w = watchList().list; if (w.indexOf(c.cc) < 0) w.push(c.cc); save(WK, w); refreshAll(); } }
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
  $('q').addEventListener('input', renderNeed);
  $('region').addEventListener('change', renderNeed);
  $('sort').addEventListener('change', renderNeed);
  $('goNeed').addEventListener('click', function (e) { e.preventDefault(); $('need').scrollIntoView({ behavior: 'smooth', block: 'center' }); });

  function route() {
    var h = (location.hash || '#brief').slice(1), t = 'brief', m = h.match(/^c\/([A-Za-z]{2})$/);
    if (m) t = 'country'; else if (['brief', 'prayer', 'about'].indexOf(h) >= 0) t = h;
    ['brief', 'country', 'prayer', 'about'].forEach(function (k) { $('tab-' + k).hidden = k !== t; });
    document.querySelectorAll('nav a').forEach(function (a) { a.classList.toggle('on', a.dataset.tab === t); });
    if (t === 'prayer') renderPrayer();
    if (t === 'country') renderProfile(m[1].toUpperCase());
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  /* section bar: scroll to a section, and highlight the one in view */
  function secBar() {
    var bar = $('secnav'); if (!bar) return;
    var btns = bar.querySelectorAll('button');
    function sizes() { var hd = document.querySelector('header.top'); if (hd) document.documentElement.style.setProperty('--hh', hd.offsetHeight + 'px'); document.documentElement.style.setProperty('--sh', bar.offsetHeight + 'px'); }
    function spy() {
      if ($('tab-brief').hidden) return;
      var y = (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hh'), 10) || 68) + bar.offsetHeight + 24, cur = null;
      btns.forEach(function (b) { var el = $(b.dataset.sec); if (el && el.getBoundingClientRect().top <= y) cur = b; });
      btns.forEach(function (b) { b.classList.toggle('on', b === cur); });
      if (cur) { var r = cur.getBoundingClientRect(), p = cur.parentNode; if (r.left < 0 || r.right > innerWidth) p.scrollTo({ left: cur.offsetLeft - 24, behavior: 'smooth' }); }
    }
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-sec]'); if (!b) return;
      var el = $(b.dataset.sec); if (el) el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    });
    window.addEventListener('scroll', spy, { passive: true });
    window.addEventListener('resize', function () { sizes(); spy(); });
    sizes(); spy();
  }
  secBar();

  function refreshAll() {
    renderBrief(); renderPrayer();
    if (!$('tab-country').hidden) { var m = location.hash.match(/^#c\/([A-Za-z]{2})$/); if (m) renderProfile(m[1].toUpperCase()); }
  }
  function boot(data) {
    D = data; D.countries.forEach(function (c) { byCc[c.cc] = c; });
    view = load(VK, 'w7') === 'w30' ? 'w30' : 'w7';
    $('countryList').innerHTML = D.countries.map(function (c) { return '<option value="' + esc(c.k) + '">'; }).join('');
    var regions = {}; D.countries.forEach(function (c) { regions[c.region] = 1; });
    $('region').innerHTML = '<option value="">All regions</option>' + Object.keys(regions).sort().map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('');
    var age = (Date.now() - new Date(D.generated)) / 36e5, bn = $('banner'), msg = '';
    if (age > 12) { msg = 'This data is ' + Math.round(age) + ' hours old; the latest refresh may have failed.'; bn.className = 'banner warn'; }
    else if (!D.baselineReady) { msg = 'Demo note: Upstream is still collecting history. Levels use severity rules only until about ' + baselineDate() + ', after which each country is compared with its own normal.'; }
    if (msg) { bn.textContent = msg; bn.hidden = false; }
    renderBrief(); renderAbout(); route();
    fetch('world.json').then(function (r) { return r.json(); }).then(function (j) { world = j; renderMap(); }).catch(function () { $('map').innerHTML = '<div class="empty">The map could not be loaded.</div>'; });
  }
  fetch('data/brief.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(boot).catch(function () {
    $('heroLine').textContent = 'The brief could not be loaded. Please refresh in a minute.'; $('dateline').textContent = 'Error';
  });
})();
