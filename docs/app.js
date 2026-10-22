/* Duracell KPI web report – plain JavaScript, no libraries.
   Reads data/report.json (built by builder/build_data.py) and recalculates
   every measure in the browser when a slicer changes. */
(function () {
  'use strict';

  // ---------------------------------------------------------------- config
  var TARGETS = { osa: 0.90, DURACELL: 0.65, ENERGIZER: 0.35, EVEREADY: 0.40 };
  var BRAND_LABEL = { DURACELL: 'Duracell Share', ENERGIZER: 'Share Energizer', EVEREADY: 'Share Eveready',
    SUPERPOWER: 'Share Superpower', HOUSEBRAND: 'Share Housebrand', OTHER: 'Share Other' };

  var PAGES = [
    { id: 'summary', tab: 'Executive Summary', title: 'EXECUTIVE SUMMARY', banners: null, logos: ['duracell.png'], osa: 'blend' },
    { id: 'spar', tab: 'Spar', title: 'SPAR', banners: ['Kwikspar', 'Spar', 'Superspar'], logos: ['spar.png', 'duracell.png'], osa: 'blend' },
    { id: 'pnp-franchise', tab: 'PnP Franchise', title: 'PNP FRANCHISE', banners: ['Pick N Pay Family'], logos: ['duracell.png'], osa: 'blend' },
    { id: 'pnp-corporate', tab: 'PnP Corporate', title: 'PNP CORPORATE', banners: ['Pick N Pay Corporate', 'Pick N Pay Hypermarkets', 'Pick N Pay Local'],
      logos: ['duracell.png'], osa: 'stock', excludeProducts: ['Mainline Plus D 2s', 'Plus AAA Power Boost 8 Pack'] },
    { id: 'checkers', tab: 'Checkers', title: 'CHECKERS', banners: ['Checkers', 'Checkers Hyper'], logos: ['checkers.png', 'duracell.png'], osa: 'blend' },
    { id: 'shoprite', tab: 'Shoprite', title: 'SHOPRITE', banners: ['Shoprite C&C', 'Shoprite Mini', 'Shoprite'], logos: ['simply-duracell.png', 'shoprite.jpg'], osa: 'stock' },
    { id: 'pnp-fsu', tab: 'PnP FSU', title: 'PNP FSU', banners: ['Pick N Pay Corporate', 'Pick N Pay Hypermarkets', 'Pick N Pay Local', 'Pick N Pay Mini Market'], logos: ['duracell.png'], osa: 'none' }
  ];

  // ---------------------------------------------------------------- state
  var D = null;
  var state = { page: 'summary', channel: new Set(), division: new Set(), month: new Set(), region: new Set() };

  // ---------------------------------------------------------------- helpers
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pct(x) { return x == null || isNaN(x) ? '' : (x * 100).toFixed(1) + '%'; }
  function num(n) { return n == null ? '' : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function monthLabel(i) { var p = D.months[i].split('-'); return MON[+p[1] - 1] + ' ' + p[0]; }
  function quarterOf(i) { var p = D.months[i].split('-'); return p[0] + ' Q' + Math.ceil(+p[1] / 3); }
  function fmtDate(iso) { var p = iso.split('-'); return +p[2] + ' ' + MON[+p[1] - 1] + ' ' + p[0]; }
  function page() { return PAGES.filter(function (p) { return p.id === state.page; })[0] || PAGES[0]; }
  function cls(v, target) { if (v == null || target == null) return ''; return v < target ? 'below' : 'ok'; }

  // ---------------------------------------------------------------- filter masks
  function storeMask(pg) {
    var n = D.stores.length, m = new Uint8Array(n);
    var bannerOk = null;
    if (pg.banners) { bannerOk = {}; pg.banners.forEach(function (b) { var i = D.banners.indexOf(b); if (i >= 0) bannerOk[i] = 1; }); }
    for (var s = 0; s < n; s++) {
      var st = D.stores[s];
      if (bannerOk && !bannerOk[st[0]]) continue;
      if (state.region.size && !state.region.has(st[1])) continue;
      if (state.division.size && !state.division.has(st[2])) continue;
      if (state.channel.size && !state.channel.has(st[3])) continue;
      m[s] = 1;
    }
    return m;
  }
  function monthMask() {
    var m = new Uint8Array(D.months.length);
    for (var i = 0; i < m.length; i++) m[i] = state.month.size ? (state.month.has(i) ? 1 : 0) : 1;
    return m;
  }
  function productMask(pg) {
    var m = new Uint8Array(D.products.length).fill(1);
    (pg.excludeProducts || []).forEach(function (p) { var i = D.products.indexOf(p); if (i >= 0) m[i] = 0; });
    return m;
  }
  function ctx() { var pg = page(); return { pg: pg, S: storeMask(pg), M: monthMask(), P: productMask(pg) }; }

  // ---------------------------------------------------------------- measures
  /* OSA.
     mode 'blend' = Power BI "OSA Products On Shelf %": every store uses its own
       source (survey for PnP Family + Spar banners, inventory SOH for the rest),
       then the stores are averaged.
     mode 'stock' = "Stockfix OSA %": inventory lines on shelf / all lines.
     mode 'survey' = "OSA Survey %": yes answers / all answers.
     keyOf(store, month, product) returns the group key (or null to skip). */
  function osa(c, mode, keyOf) {
    var groups = new Map();
    function add(rows, wantSurvey) {
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i], s = r[0];
        if (!c.S[s] || !c.M[r[1]] || !c.P[r[2]]) continue;
        if (wantSurvey !== null && D.stores[s][4] !== wantSurvey) continue;
        var k = keyOf(s, r[1], r[2]); if (k == null) continue;
        var g = groups.get(k); if (!g) { g = { p: 0, n: 0, st: new Map() }; groups.set(k, g); }
        g.p += r[3]; g.n += r[4];
        if (mode === 'blend') { var a = g.st.get(s); if (!a) { a = [0, 0]; g.st.set(s, a); } a[0] += r[3]; a[1] += r[4]; }
      }
    }
    if (mode === 'blend') { add(D.osaSurvey, 1); add(D.osaInventory, 0); }
    else if (mode === 'stock') add(D.osaInventory, null);
    else add(D.osaSurvey, null);
    var out = new Map();
    groups.forEach(function (g, k) {
      if (mode === 'blend') {
        var sum = 0, cnt = 0;
        g.st.forEach(function (a) { if (a[1] > 0) { sum += a[0] / a[1]; cnt++; } });
        out.set(k, cnt ? sum / cnt : null);
      } else out.set(k, g.n ? g.p / g.n : null);
    });
    return out;
  }
  // Forward share: brand pegs / all pegs, per group
  function share(c, keyOf) {
    var out = new Map();
    for (var i = 0; i < D.share.length; i++) {
      var r = D.share[i];
      if (!c.S[r[0]] || !c.M[r[1]]) continue;
      var k = keyOf(r[0], r[1]); if (k == null) continue;
      var g = out.get(k); if (!g) { g = [0, 0, 0, 0, 0, 0]; out.set(k, g); }
      g[r[2]] += r[3];
    }
    var res = new Map();
    out.forEach(function (g, k) {
      var t = g.reduce(function (a, b) { return a + b; }, 0), o = {};
      D.brands.forEach(function (b, j) { o[b] = t ? g[j] / t : null; });
      res.set(k, o);
    });
    return res;
  }
  function storeSet(rows, c, keyOf, extra) {
    var out = new Map();
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!c.S[r[0]] || !c.M[r[1]]) continue;
      if (extra && !extra(r)) continue;
      var k = keyOf(r[0], r[1]); if (k == null) continue;
      var g = out.get(k); if (!g) { g = new Set(); out.set(k, g); }
      g.add(r[0]);
    }
    return out;
  }
  function headline(c) {
    var all = function () { return 'all'; };
    var uni = storeSet(D.universe, c, all).get('all') || new Set();
    var vis = c.pg.id === 'pnp-fsu' ? (storeSet(D.fsu, c, all).get('all') || new Set()) : (storeSet(D.visits, c, all).get('all') || new Set());
    var done = 0; uni.forEach(function (s) { if (vis.has(s)) done++; });
    // Time elapsed for the latest selected month
    var latest = -1;
    for (var i = 0; i < D.months.length; i++) if (c.M[i] && monthHasData(i)) latest = i;
    var te = null;
    if (latest >= 0) {
      var p = D.months[latest].split('-'), y = +p[0], mo = +p[1] - 1, now = new Date();
      var days = new Date(y, mo + 1, 0).getDate();
      if (y < now.getFullYear() || (y === now.getFullYear() && mo < now.getMonth())) te = 1;
      else if (y === now.getFullYear() && mo === now.getMonth()) te = Math.min(now.getDate(), days) / days;
      else te = 0;
    }
    return { timeElapsed: te, completion: uni.size ? done / uni.size : null, universe: uni.size, visited: vis.size };
  }
  var _monthData = null;
  function monthHasData(i) {
    if (!_monthData) {
      _monthData = new Uint8Array(D.months.length);
      [D.osaSurvey, D.osaInventory, D.share, D.visits].forEach(function (rows) { rows.forEach(function (r) { _monthData[r[1]] = 1; }); });
    }
    return _monthData[i] === 1;
  }

  // ---------------------------------------------------------------- render: slicers
  var DIMS = {
    channel: { label: 'CHANNEL', list: function () { return D.channels; } },
    division: { label: 'DIVISION', list: function () { return D.divisions; } },
    month: { label: 'YEAR MONTH', list: function () { return D.months.map(function (m, i) { return monthLabel(i); }); } }
  };
  function renderSlicers() {
    document.querySelectorAll('.slicer').forEach(function (box) {
      var dim = box.getAttribute('data-dim'), def = DIMS[dim], items = def.list(), sel = state[dim];
      var open = box.querySelector('details') && box.querySelector('details').open;
      var val = sel.size === 0 ? 'All' : sel.size === 1 ? items[Array.from(sel)[0]] : 'Multiple selections';
      var h = '<details' + (open ? ' open' : '') + '><summary><span class="s-lbl">' + def.label + '</span><span class="s-val">' + esc(val) + '</span></summary><div class="menu">';
      h += '<label class="all"><input type="checkbox" data-all="1"' + (sel.size === 0 ? ' checked' : '') + '> Select all</label>';
      items.forEach(function (it, i) { h += '<label><input type="checkbox" data-i="' + i + '"' + (sel.has(i) ? ' checked' : '') + '> ' + esc(it) + '</label>'; });
      box.innerHTML = h + '</div></details>';
      box.querySelectorAll('input').forEach(function (inp) {
        inp.addEventListener('change', function () {
          if (inp.getAttribute('data-all')) sel.clear();
          else { var i = +inp.getAttribute('data-i'); if (inp.checked) sel.add(i); else sel.delete(i); if (sel.size === items.length) sel.clear(); }
          render();
        });
      });
    });
  }
  function renderRegions() {
    var h = '';
    D.regions.forEach(function (r, i) { h += '<button type="button" data-i="' + i + '" aria-pressed="' + state.region.has(i) + '">' + esc(r) + '</button>'; });
    el('regions').innerHTML = h;
    el('regions').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { var i = +b.getAttribute('data-i'); if (state.region.has(i)) state.region.delete(i); else state.region.add(i); render(); });
    });
  }
  function renderTabs() {
    el('tabs').innerHTML = PAGES.map(function (p) {
      return '<a href="#' + p.id + '"' + (p.id === state.page ? ' aria-current="page"' : '') + '>' + esc(p.tab) + '</a>';
    }).join('');
  }
  function renderHeader(c, hl) {
    el('pageTitle').textContent = c.pg.title;
    document.title = c.pg.tab + ' | Duracell KPI';
    el('brandLogos').innerHTML = c.pg.logos.map(function (l) { return '<img src="assets/' + l + '" alt="">'; }).join('');
    el('lastDate').textContent = fmtDate(D.lastDataDate);
    function card(v, l, bar) {
      return '<div class="kpi"><span class="v">' + v + '</span><span class="l">' + l + '</span>' +
        (bar != null ? '<span class="bar"><span style="width:' + Math.round(bar * 100) + '%"></span></span>' : '') + '</div>';
    }
    el('kpiStrip').innerHTML =
      card(hl.timeElapsed == null ? '–' : pct(hl.timeElapsed), 'Time Elapsed', hl.timeElapsed) +
      card(hl.completion == null ? '–' : pct(hl.completion), 'Store Completion', hl.completion) +
      card(num(hl.universe), 'Store Universe (' + num(hl.visited) + ' visited)', null);
  }

  // ---------------------------------------------------------------- render: building blocks
  function visual(title, sub, body, extraClass) {
    return '<div class="visual ' + (extraClass || '') + '"><h2>' + esc(title) + '</h2>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + body + '</div>';
  }
  function band(inner) { return '<section class="band"><div class="row">' + inner + '</div></section>'; }
  var LEGEND = '<div class="legend"><span><i style="background:var(--below)"></i>Below target</span></div>';

  function activeMonths(c, osaMap, shareMap) {
    var out = [];
    for (var i = 0; i < D.months.length; i++) if (c.M[i] && ((osaMap && osaMap.get(i) != null) || (shareMap && shareMap.has(i)))) out.push(i);
    return out;
  }

  // KPI rows x months matrix (+ selected period + target)
  function kpiMatrix(c, mode, title) {
    var osaM = mode === 'none' ? new Map() : osa(c, mode, function (s, m) { return m; });
    var osaT = mode === 'none' ? new Map() : osa(c, mode, function () { return 'T'; });
    var shM = share(c, function (s, m) { return m; });
    var shT = share(c, function () { return 'T'; });
    var months = activeMonths(c, osaM, shM);
    if (!months.length) return visual(title, '', '<p class="empty">No data for the selected filters.</p>', 'table-v grow');
    // quarter header
    var qs = [], last = null;
    months.forEach(function (m) { var q = quarterOf(m); if (q !== last) { qs.push([q, 1]); last = q; } else qs[qs.length - 1][1]++; });
    var h = '<div class="scroll"><table><thead><tr class="q"><th></th>' + qs.map(function (q) { return '<th colspan="' + q[1] + '" style="text-align:center">' + q[0] + '</th>'; }).join('') +
      '<th></th><th class="tgt"></th></tr><tr><th>KPI</th>' + months.map(function (m) { return '<th>' + monthLabel(m) + '</th>'; }).join('') +
      '<th>Selected period</th><th class="tgt">Target</th></tr></thead><tbody>';
    var rows = [];
    if (mode !== 'none') rows.push({ name: 'OSA Products On Shelf %', get: function (m) { return m === 'T' ? osaT.get('T') : osaM.get(m); }, t: TARGETS.osa });
    D.brands.forEach(function (b) {
      var any = false; shT.forEach(function (o) { if (o[b]) any = true; });
      if (!any && (b === 'SUPERPOWER')) return;
      rows.push({ name: BRAND_LABEL[b], get: function (m) { var o = m === 'T' ? shT.get('T') : shM.get(m); return o ? o[b] : null; }, t: TARGETS[b], hl: b === 'DURACELL' });
    });
    rows.forEach(function (r) {
      var highlight = r.name.indexOf('OSA') === 0 || r.hl;
      h += '<tr><td>' + r.name + '</td>';
      months.concat(['T']).forEach(function (m) { var v = r.get(m); h += '<td class="' + (highlight ? cls(v, r.t) : '') + '">' + pct(v) + '</td>'; });
      h += '<td class="tgt">' + (r.t != null ? pct(r.t) : '') + '</td></tr>';
    });
    h += '</tbody></table></div>';
    return visual(title, '', LEGEND + h, 'table-v grow');
  }

  // Rows = a store attribute (banner / region), columns = KPIs
  function attrMatrix(c, attrIdx, names, mode, title, includeSuperpower, sub) {
    var osaG = osa(c, mode, function (s) { return D.stores[s][attrIdx]; });
    var osaT = osa(c, mode, function () { return 'T'; });
    var shG = share(c, function (s) { return D.stores[s][attrIdx]; });
    var shT = share(c, function () { return 'T'; });
    var brands = D.brands.filter(function (b) { return includeSuperpower || b !== 'SUPERPOWER'; });
    var keys = names.map(function (n, i) { return i; }).filter(function (i) { return osaG.get(i) != null || shG.has(i); });
    if (!keys.length) return visual(title, sub, '<p class="empty">No data for the selected filters.</p>', 'table-v grow');
    var h = '<div class="scroll"><table><thead><tr><th>' + (attrIdx === 0 ? 'Banner' : 'Region') + '</th><th>' + (mode === 'stock' ? 'Stockfix OSA %' : 'OSA Products On Shelf %') + '</th>' +
      brands.map(function (b) { return '<th>' + BRAND_LABEL[b] + '</th>'; }).join('') + '</tr></thead><tbody>';
    function line(label, ov, so, total) {
      var r = '<tr' + (total ? ' class="total"' : '') + '><td>' + esc(label) + '</td><td class="' + cls(ov, TARGETS.osa) + '">' + pct(ov) + '</td>';
      brands.forEach(function (b) { var v = so ? so[b] : null; r += '<td class="' + (b === 'DURACELL' ? cls(v, TARGETS.DURACELL) : '') + '">' + pct(v) + '</td>'; });
      return r + '</tr>';
    }
    keys.forEach(function (i) { h += line(names[i], osaG.get(i), shG.get(i)); });
    h += line('Total', osaT.get('T'), shT.get('T'), true);
    return visual(title, sub, LEGEND + h + '</tbody></table></div>', 'table-v grow');
  }

  // Rows = region, columns = products, value = OSA
  function regionProductMatrix(c, mode, title) {
    var g = osa(c, mode, function (s, m, p) { return D.stores[s][1] + '|' + p; });
    var rT = osa(c, mode, function (s) { return D.stores[s][1]; });
    var pT = osa(c, mode, function (s, m, p) { return p; });
    var all = osa(c, mode, function () { return 'T'; });
    var prods = D.products.map(function (p, i) { return i; }).filter(function (i) { return pT.get(i) != null; });
    var regs = D.regions.map(function (r, i) { return i; }).filter(function (i) { return rT.get(i) != null; });
    if (!prods.length) return visual(title, '', '<p class="empty">No data for the selected filters.</p>', 'table-v grow');
    var h = '<div class="scroll"><table><thead><tr><th>Region</th>' + prods.map(function (p) { return '<th class="prod">' + esc(D.products[p]) + '</th>'; }).join('') + '<th>Total</th></tr></thead><tbody>';
    regs.forEach(function (r) {
      h += '<tr><td>' + esc(D.regions[r]) + '</td>' + prods.map(function (p) { var v = g.get(r + '|' + p); return '<td class="' + cls(v, TARGETS.osa) + '">' + pct(v) + '</td>'; }).join('') +
        '<td class="' + cls(rT.get(r), TARGETS.osa) + '">' + pct(rT.get(r)) + '</td></tr>';
    });
    h += '<tr class="total"><td>Total</td>' + prods.map(function (p) { var v = pT.get(p); return '<td class="' + cls(v, TARGETS.osa) + '">' + pct(v) + '</td>'; }).join('') +
      '<td class="' + cls(all.get('T'), TARGETS.osa) + '">' + pct(all.get('T')) + '</td></tr>';
    return visual(title, 'Scroll sideways to see all products', LEGEND + h + '</tbody></table></div>', 'table-v grow');
  }

  // SVG column chart
  function columnChart(labels, values, target, color) {
    var W = 300, H = 190, pl = 34, pr = 8, pt = 22, pb = 26, max = Math.max.apply(null, values.filter(function (v) { return v != null; }).concat([target || 0, 0.01]));
    max = Math.min(1, Math.ceil(max * 10) / 10 + 0.0001);
    var bw = (W - pl - pr) / Math.max(labels.length, 1), y = function (v) { return pt + (1 - v / max) * (H - pt - pb); };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img">';
    [0, max / 2, max].forEach(function (g) { s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(g) + '" y2="' + y(g) + '" stroke="#eee"/><text x="' + (pl - 4) + '" y="' + (y(g) + 4) + '" font-size="10" fill="#666" text-anchor="end">' + Math.round(g * 100) + '%</text>'; });
    labels.forEach(function (l, i) {
      var v = values[i], x = pl + i * bw + bw * 0.18, w = bw * 0.64;
      if (v != null) s += '<rect x="' + x + '" y="' + y(v) + '" width="' + w + '" height="' + (H - pb - y(v)) + '" fill="' + (color || '#e66c37') + '"><title>' + esc(l) + ': ' + pct(v) + '</title></rect>' +
        '<text x="' + (x + w / 2) + '" y="' + (y(v) - 5) + '" font-size="11" font-weight="600" fill="#252423" text-anchor="middle">' + pct(v) + '</text>';
      s += '<text x="' + (x + w / 2) + '" y="' + (H - 8) + '" font-size="11" fill="#252423" text-anchor="middle">' + esc(l) + '</text>';
    });
    if (target != null && target <= max) s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(target) + '" y2="' + y(target) + '" stroke="#252423" stroke-dasharray="4 3"/><text x="' + (W - pr) + '" y="' + (y(target) - 4) + '" font-size="10" fill="#252423" text-anchor="end">Target ' + pct(target) + '</text>';
    return s + '</svg>';
  }
  // SVG line chart
  function lineChart(labels, values, color, width) {
    var W = width || 560, H = 200, pl = 40, pr = 34, pt = 24, pb = 28;
    var vs = values.filter(function (v) { return v != null; });
    if (!vs.length) return '<p class="empty">No data for the selected filters.</p>';
    var lo = Math.max(0, Math.floor((Math.min.apply(null, vs) - 0.05) * 10) / 10), hi = Math.min(1, Math.ceil((Math.max.apply(null, vs) + 0.03) * 10) / 10);
    if (hi - lo < 0.1) lo = Math.max(0, hi - 0.1);
    var x = function (i) { return labels.length < 2 ? (pl + W - pr) / 2 : pl + i * (W - pl - pr) / (labels.length - 1); };
    var y = function (v) { return pt + (hi - v) / (hi - lo) * (H - pt - pb); };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img">';
    [lo, (lo + hi) / 2, hi].forEach(function (g) { s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(g) + '" y2="' + y(g) + '" stroke="#eee"/><text x="' + (pl - 6) + '" y="' + (y(g) + 4) + '" font-size="10" fill="#666" text-anchor="end">' + Math.round(g * 100) + '%</text>'; });
    var pts = []; values.forEach(function (v, i) { if (v != null) pts.push(x(i).toFixed(1) + ',' + y(v).toFixed(1)); });
    s += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + (color || '#744ec2') + '" stroke-width="2.5"/>';
    values.forEach(function (v, i) {
      if (v != null) s += '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="4" fill="' + (color || '#744ec2') + '"><title>' + esc(labels[i]) + ': ' + pct(v) + '</title></circle><text x="' + x(i) + '" y="' + (y(v) - 9) + '" font-size="11" font-weight="600" fill="#252423" text-anchor="middle">' + pct(v) + '</text>';
      s += '<text x="' + x(i) + '" y="' + (H - 8) + '" font-size="11" fill="#252423" text-anchor="middle">' + esc(labels[i]) + '</text>';
    });
    return s + '</svg>';
  }
  function quarterSeries(map) {
    var labels = [], vals = [];
    Array.from(map.keys()).sort().forEach(function (k) { labels.push(k); vals.push(map.get(k)); });
    return [labels, vals];
  }

  // ---------------------------------------------------------------- render: pages
  function renderSummary(c) {
    var osaQ = osa(c, 'blend', function (s, m) { return quarterOf(m); });
    var shQ = share(c, function (s, m) { return quarterOf(m); });
    var dq = new Map(); shQ.forEach(function (o, k) { dq.set(k, o.DURACELL); });
    var a = quarterSeries(osaQ), b = quarterSeries(dq);
    return band(kpiMatrix(c, 'blend', 'KPI by month') +
      visual('OSA Products On Shelf % by quarter', '', columnChart(a[0], a[1], TARGETS.osa), 'side')) +
      band(attrMatrix(c, 0, D.banners, 'blend', 'KPI by banner', false, 'OSA uses the survey for PnP Family and Spar banners, and weekly inventory (SOH &gt; 0) for all other banners.') +
      visual('Duracell Share by quarter', '', columnChart(b[0], b[1], TARGETS.DURACELL), 'side'));
  }
  function renderSpar(c) {
    // numeric distribution
    var noStoreFilter = !state.region.size && !state.division.size && !state.channel.size;
    var byDcCl = new Map(), byProd = new Map(), byMonth = new Map(), byDc = new Map(), byCl = new Map(), tot = [0, 0];
    D.nd.forEach(function (r) {
      if (!c.M[r[1]]) return;
      if (r[0] >= 0 ? !c.S[r[0]] : !noStoreFilter) return;
      function add(map, k) { var g = map.get(k); if (!g) { g = [0, 0]; map.set(k, g); } g[0] += r[5]; g[1] += r[6]; }
      add(byDcCl, r[4] + '|' + r[3]); add(byProd, r[2]); add(byMonth, r[1]); add(byDc, r[4]); add(byCl, r[3]);
      tot[0] += r[5]; tot[1] += r[6];
    });
    var nd = function (g) { return g && g[1] ? g[0] / g[1] : null; };
    var cls_ = D.clusters.map(function (x, i) { return i; }).filter(function (i) { return byCl.has(i); });
    var dcs = D.dcs.map(function (x, i) { return i; }).filter(function (i) { return byDc.has(i); });
    var t1 = '<div class="scroll"><table><thead><tr><th>Managing DC</th>' + cls_.map(function (i) { return '<th>' + esc(D.clusters[i]) + '</th>'; }).join('') + '<th>Total</th></tr></thead><tbody>';
    dcs.forEach(function (d) { t1 += '<tr><td>' + esc(D.dcs[d]) + '</td>' + cls_.map(function (k) { return '<td>' + pct(nd(byDcCl.get(d + '|' + k))) + '</td>'; }).join('') + '<td>' + pct(nd(byDc.get(d))) + '</td></tr>'; });
    t1 += '<tr class="total"><td>Total</td>' + cls_.map(function (k) { return '<td>' + pct(nd(byCl.get(k))) + '</td>'; }).join('') + '<td>' + pct(nd(tot)) + '</td></tr></tbody></table></div>';
    var t2 = '<table><thead><tr><th>Product</th><th>Numeric Distr</th></tr></thead><tbody>';
    D.ndProducts.forEach(function (p, i) { if (byProd.has(i)) t2 += '<tr><td>' + esc(p) + '</td><td>' + pct(nd(byProd.get(i))) + '</td></tr>'; });
    t2 += '<tr class="total"><td>Total</td><td>' + pct(nd(tot)) + '</td></tr></tbody></table>';
    var ms = Array.from(byMonth.keys()).sort(function (a, b) { return a - b; });
    var line = lineChart(ms.map(function (m) { return MON[+D.months[m].split('-')[1] - 1]; }), ms.map(function (m) { return nd(byMonth.get(m)); }), '#744ec2', 1100);
    var sub = 'Share of store and product cells in Spar sales data that sold (Sales &gt; 0). Cluster 5 excluded.';
    return band(kpiMatrix(c, 'blend', 'KPI by month')) +
      band(visual('Numeric distribution by Managing DC and cluster', sub, tot[1] ? t1 : '<p class="empty">No data.</p>', 'table-v grow') +
        visual('Numeric distribution by product', '', tot[1] ? '<div class="scroll">' + t2 + '</div>' : '<p class="empty">No data.</p>', 'table-v side')) +
      band(visual('Numeric distribution by month', '', line, 'grow'));
  }
  function renderPnpFranchise(c) {
    return band(kpiMatrix(c, 'blend', 'KPI by month')) + band(regionProductMatrix(c, 'blend', 'OSA Products On Shelf % by region and product'));
  }
  function renderPnpCorporate(c) {
    return band(kpiMatrix(c, 'stock', 'KPI by month')) + band(regionProductMatrix(c, 'stock', 'Stockfix OSA % by region and product'));
  }
  function renderRetail(c) {
    return band(kpiMatrix(c, c.pg.osa, 'KPI by month')) + band(attrMatrix(c, 1, D.regions, 'stock', 'KPI by region', true));
  }
  function renderFsu(c) {
    var yes = storeSet(D.fsu, c, function (s, m) { return m; }, function (r) { return r[2] === 1; });
    var ans = storeSet(D.fsu, c, function (s, m) { return m; });
    var ms = Array.from(ans.keys()).sort(function (a, b) { return a - b; });
    var line = lineChart(ms.map(monthLabel), ms.map(function (m) { return (yes.get(m) || new Set()).size / ans.get(m).size; }), '#e66c37', 1100);
    var key = function (s, m) { return D.stores[s][1] + '|' + m; };
    var u = storeSet(D.universe, c, key), a2 = storeSet(D.fsu, c, key), y2 = storeSet(D.fsu, c, key, function (r) { return r[2] === 1; });
    var months = ms.slice();
    var h;
    if (!months.length) h = '<p class="empty">No FSU answers for the selected filters.</p>';
    else {
      h = '<div class="scroll"><table><thead><tr class="q"><th></th>' + months.map(function (m) { return '<th colspan="3" style="text-align:center">' + monthLabel(m) + '</th>'; }).join('') + '</tr><tr><th>Region</th>' +
        months.map(function () { return '<th>Store Universe</th><th>#Stores Captured</th><th>PNP FSU</th>'; }).join('') + '</tr></thead><tbody>';
      D.regions.forEach(function (r, ri) {
        var any = months.some(function (m) { return u.has(ri + '|' + m) || a2.has(ri + '|' + m); }); if (!any) return;
        h += '<tr><td>' + esc(r) + '</td>' + months.map(function (m) {
          var k = ri + '|' + m, uu = u.get(k), aa = a2.get(k), yy = y2.get(k);
          return '<td>' + (uu ? num(uu.size) : '') + '</td><td>' + (aa ? num(aa.size) : '') + '</td><td>' + (aa ? pct((yy ? yy.size : 0) / aa.size) : '') + '</td>';
        }).join('') + '</tr>';
      });
      h += '</tbody></table></div>';
    }
    return band(visual('PNP FSU by month', 'Stores with an FSU, or a Powerwing side panel instead / stores that answered', line, 'grow')) +
      band(visual('FSU by region', '', h, 'table-v grow'));
  }

  // ---------------------------------------------------------------- main render
  function render() {
    if (!D) return;
    var c = ctx();
    renderTabs(); renderSlicers(); renderRegions();
    renderHeader(c, headline(c));
    var html;
    switch (c.pg.id) {
      case 'spar': html = renderSpar(c); break;
      case 'pnp-franchise': html = renderPnpFranchise(c); break;
      case 'pnp-corporate': html = renderPnpCorporate(c); break;
      case 'checkers': case 'shoprite': html = renderRetail(c); break;
      case 'pnp-fsu': html = renderFsu(c); break;
      default: html = renderSummary(c);
    }
    el('content').innerHTML = html;
    el('footNote').textContent = 'Data refreshed ' + D.generated + '. OSA: survey for PnP Family and Spar banners; weekly inventory (SOH > 0) for other banners.';
  }

  function fromHash() {
    var id = (location.hash || '').replace('#', '');
    state.page = PAGES.some(function (p) { return p.id === id; }) ? id : 'summary';
    render();
  }
  window.addEventListener('hashchange', fromHash);
  el('clearAll').addEventListener('click', function () { ['channel', 'division', 'month', 'region'].forEach(function (k) { state[k].clear(); }); render(); });
  document.addEventListener('click', function (e) {
    document.querySelectorAll('.slicer details[open]').forEach(function (d) { if (!d.contains(e.target)) d.open = false; });
  });

  fetch('data/report.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (d) {
    D = d; fromHash();
  }).catch(function () { el('content').innerHTML = '<p class="loading">The report data could not be loaded.</p>'; });
})();
