// Dashboard výkonu obchodníků — data z posledního snímku v Sheetu (JSON { sloupce, radky }), nic se neukládá.
// Výpočty, pořadí a barevné škály jsou stejné jako ve skriptu v Sheetu; vzhled je vlastní (tmavý dashboard).
//   Záložka Skóre: jedno období na obrazovku (celá doba / 3 měsíce / 30 dní), u každého skóre jeho složky.
//   Záložka Měsíční data: obrat, zisk, marže, schůzky a nabídky po měsících pod sebou (scroll).
// Přístup: heslo ověřuje skript v Sheetu (?co=vedeni&h=…); stránka heslo nezná, jen ho pošle.
(function () {
  'use strict';

  // ── konstanty shodné se skriptem v Sheetu ──
  var MONTH_LABELS = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'];
  var HEAT_FLOOR_PCT = 0.12, HEAT_GAMMA = 0.75, ALERT_MIN_MONTHS = 2;
  var VYCHOZI_VAHY = { obrat: 50, zisk: 35, schuzky: 15 }, VYCHOZI_HRANICE = 1200000;

  function hx(x) { var s = Math.round(x).toString(16); return s.length < 2 ? '0' + s : s; }
  function mix(a, b, f) { return '#' + hx(a[0] + (b[0] - a[0]) * f) + hx(a[1] + (b[1] - a[1]) * f) + hx(a[2] + (b[2] - a[2]) * f); }
  function heatColor(t) {
    if (t < 0) t = 0; if (t > 1) t = 1;
    var c1 = [248, 105, 107], c2 = [255, 235, 132], c3 = [99, 190, 123];
    return t < 0.5 ? mix(c1, c2, t / 0.5) : mix(c2, c3, (t - 0.5) / 0.5);
  }
  function heatColorRich(t) {
    if (t < 0) t = 0; if (t > 1) t = 1;
    var st = [[230, 124, 115], [246, 178, 107], [255, 217, 102], [164, 210, 130], [87, 171, 90]];
    var seg = 1 / (st.length - 1), i = Math.min(Math.floor(t / seg), st.length - 2);
    return mix(st[i], st[i + 1], (t - i * seg) / seg);
  }
  function heat3Rel(v, hi) { if (hi <= 0) return heatColor(0); var fl = hi * HEAT_FLOOR_PCT; return heatColor(Math.pow(Math.max(0, (v - fl) / (hi - fl)), HEAT_GAMMA)); }
  function ymToIdx(ym) { return parseInt(String(ym).substring(0, 4), 10) * 12 + parseInt(String(ym).substring(5, 7), 10); }
  function vedMil(v) { return v >= 1000000 ? (v / 1000000).toFixed(2).replace('.', ',') + ' M' : Math.round(v / 1000) + ' K'; }
  function vedDen(iso) { return parseInt(iso.substring(8, 10), 10) + '. ' + parseInt(iso.substring(5, 7), 10) + '. ' + iso.substring(0, 4); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ── kontext ze snímku (stejně jako kontextZeSnimku_ v Sheetu) ──
  function kontext(data) {
    var H = data.sloupce;
    function num(r, n) { var j = H.indexOf(n); var v = j < 0 ? '' : r[j]; return (v === '' || v === null) ? 0 : Number(v); }
    function txt(r, n) { var j = H.indexOf(n); return j < 0 ? '' : String(r[j]); }
    var rows = data.radky.filter(function (r) { return r[0] && num(r, 'schema') >= 2; });
    if (!rows.length) throw new Error('Ve zdroji zatím není žádný snímek.');
    var den = rows.map(function (r) { return txt(r, 'snimek'); }).sort().pop();
    var dnes = rows.filter(function (r) { return txt(r, 'snimek') === den; });
    var year = num(dnes[0], 'rok') || parseInt(den.substring(0, 4), 10);
    var prev = rows.filter(function (r) { return num(r, 'rok') === year - 1; });
    var prevDen = prev.map(function (r) { return txt(r, 'snimek'); }).sort().pop() || '';
    var prevById = {};
    prev.forEach(function (r) { if (txt(r, 'snimek') === prevDen) prevById[num(r, 'raynet_id')] = r; });
    var vahy = txt(dnes[0], 'vahy').split('/').map(Number);
    var d0 = new Date(+den.substring(0, 4), +den.substring(5, 7) - 1, +den.substring(8, 10));
    var f30 = new Date(d0.getTime() - 29 * 86400000);
    var ds = function (x) { return x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2); };
    var c = {
      rowsOZ: [], ratC: {}, ratQ: {}, ratM: {}, win: {}, obYM: {}, ziYM: {}, scYM: {}, nabYM: {}, start: {},
      W: { obrat: vahy[0] || VYCHOZI_VAHY.obrat, zisk: vahy[1] || VYCHOZI_VAHY.zisk, schuzky: vahy[2] || VYCHOZI_VAHY.schuzky },
      hranice: num(dnes[0], 'hranice_slaby_mesic') || VYCHOZI_HRANICE,
      year: year, curMonthIdx: +den.substring(5, 7) - 1, todayStr: den, hhmm: txt(dnes[0], 'cas'), from30Str: ds(f30)
    };
    dnes.forEach(function (r) {
      var d = txt(r, 'oz');
      c.rowsOZ.push([d, txt(r, 'jmeno'), num(r, 'raynet_id')]);
      c.ratC[d] = num(r, 'rating_cela_doba'); c.ratQ[d] = num(r, 'rating_3_mesice'); c.ratM[d] = num(r, 'rating_30_dni');
      c.start[d] = txt(r, 'od') || (year + '-01');
      c.win[d] = {};
      [['c', 'cela'], ['q', '3m'], ['m', '30d']].forEach(function (w) {
        c.win[d][w[0]] = { dni: num(r, w[1] + '_dni') || 1, o: num(r, w[1] + '_obrat'), z: num(r, w[1] + '_zisk'), s: num(r, w[1] + '_schuzky') };
      });
      c.obYM[d] = {}; c.ziYM[d] = {}; c.scYM[d] = {}; c.nabYM[d] = {};
      var p = prevById[num(r, 'raynet_id')];
      for (var m = 1; m <= 12; m++) {
        var mm = ('0' + m).slice(-2);
        [['obrat', c.obYM], ['zisk', c.ziYM], ['schuzky', c.scYM], ['nabidky', c.nabYM]].forEach(function (x) {
          x[1][d][year + '-' + mm] = num(r, x[0] + '_' + mm);
          if (p) x[1][d][(year - 1) + '-' + mm] = num(p, x[0] + '_' + mm);
        });
      }
    });
    return c;
  }

  // ─────────────────────────── SKÓRE ───────────────────────────
  var OBDOBI = [
    { id: 'cela', k: 'c', nazev: 'Celá doba', r: 'ratC', h: 'Ø za měsíc', popis: function (c) { return 'od nástupu každého obchodníka · hodnoty jsou průměr za měsíc'; } },
    { id: '3m', k: 'q', nazev: '3 měsíce', r: 'ratQ', h: 'Ø za měsíc', popis: function (c) { return 'posledních 90 dní · hodnoty jsou průměr za měsíc'; } },
    { id: '30d', k: 'm', nazev: '30 dní', r: 'ratM', h: 'za 30 dní', popis: function (c) { return dmy(c.from30Str) + ' – ' + dmy(c.todayStr) + ' · hodnoty jsou součet za 30 dní'; } }
  ];
  function dmy(iso) { return parseInt(iso.substring(8, 10), 10) + '. ' + parseInt(iso.substring(5, 7), 10) + '.'; }
  function tisM(v) { return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

  function renderSkore(c, obdobiId) {
    var p = OBDOBI.filter(function (o) { return o.id === obdobiId; })[0] || OBDOBI[0];
    var R = c[p.r];
    function mes(d, key) { var x = c.win[d][p.k]; return x[key] / x.dni * 30; }
    var slozky = [{ key: 'o', nazev: 'Obrat', w: c.W.obrat, fmt: vedMil }, { key: 'z', nazev: 'Zisk', w: c.W.zisk, fmt: vedMil },
                  { key: 's', nazev: 'Schůzky', w: c.W.schuzky, fmt: function (v) { return String(Math.round(v)); } }];
    var hi = {};
    slozky.forEach(function (s) { hi[s.key] = Math.max.apply(null, c.rowsOZ.map(function (r) { return mes(r[0], s.key); }).concat([0])); });
    var poradi = c.rowsOZ.slice().sort(function (a, b) { return (R[b[0]] - R[a[0]]) || (c.ratC[b[0]] - c.ratC[a[0]]); });
    var ostatni = OBDOBI.filter(function (o) { return o.id !== p.id; });

    var h = ['<div class="bar"><div class="seg" role="group" aria-label="Období">' +
      OBDOBI.map(function (o) { return '<button type="button" data-obdobi="' + o.id + '" aria-pressed="' + (o.id === p.id) + '">' + o.nazev + '</button>'; }).join('') +
      '</div><span class="pozn">' + esc(p.popis(c)) + '</span></div>'];
    h.push('<div class="rank"><div class="rhead"><span>#</span><span>Obchodník</span><span>Skóre</span>' +
      slozky.map(function (s) { return '<span>' + s.nazev + ' · ' + p.h + ' <span style="opacity:.7">(' + s.w + ' %)</span></span>'; }).join('') +
      '<span>Ostatní období</span></div>');
    poradi.forEach(function (r, i) {
      var d = r[0], st = c.start[d];
      var row = '<div class="rrow"><span class="poradi">' + (i + 1) + '</span>' +
        '<div class="jmeno">' + esc(d) + '<small>v týmu od ' + MONTH_LABELS[parseInt(st.substring(5, 7), 10) - 1] + ' ' + st.substring(0, 4) + '</small></div>' +
        '<div class="skore" style="background:' + heatColorRich(R[d] / 100) + '" title="Skóre ' + R[d] + ' / 100">' + R[d] + '</div>';
      slozky.forEach(function (s) {
        var v = mes(d, s.key), podil = hi[s.key] > 0 ? v / hi[s.key] : 0, body = Math.round(podil * s.w);
        var barva = s.key === 's' ? heatColor(podil) : heat3Rel(v, hi[s.key]);
        row += '<div class="slozka"><div class="v"><em class="lbl">' + s.nazev + '</em><b>' + esc(s.fmt(v)) + '</b><span>' + Math.round(podil * 100) + ' % nejlepšího · ' + body + ' b.</span></div>' +
               '<div class="track" title="' + Math.round(podil * 100) + ' % nejlepšího v týmu"><i style="width:' + Math.max(2, podil * 100) + '%;background:' + barva + '"></i></div></div>';
      });
      row += '<div class="ostatni">' + ostatni.map(function (o) {
        return '<div><span>' + o.nazev + '</span><b style="background:' + heatColorRich(c[o.r][d] / 100) + '">' + c[o.r][d] + '</b></div>';
      }).join('') + '</div></div>';
      h.push(row);
    });
    h.push('</div><div class="legenda-skore">Skóre 0–100 = obrat ' + c.W.obrat + ' % + zisk ' + c.W.zisk + ' % + schůzky ' + c.W.schuzky +
      ' %, každá složka vůči nejlepšímu v týmu. „b.“ = body, které složka do skóre přinesla. Barva: zelená = nejlepší, červená = nejslabší.</div>');
    return h.join('');
  }

  // ─────────────────────────── MĚSÍČNÍ DATA ───────────────────────────
  var METRIKY = [
    { id: 'obrat', nazev: 'Obrat', jednotka: 'M Kč', ym: 'obYM', fmt: function (v) { return (v / 1000000).toFixed(1).replace('.', ','); }, scale: 'rel', alarm: true },
    { id: 'zisk', nazev: 'Zisk', jednotka: 'tis. Kč', ym: 'ziYM', fmt: function (v) { return tisM(v / 1000); }, scale: 'rel' },
    { id: 'marze', nazev: 'Marže', jednotka: '% (zisk ÷ obrat)', pct: true, fmt: function (v) { return Math.round(v) + ' %'; } },
    { id: 'schuzky', nazev: 'Schůzky', jednotka: 'realizované', ym: 'scYM', fmt: function (v) { return String(Math.round(v)); }, scale: 'count' },
    { id: 'nabidky', nazev: 'Nabídky', jednotka: 'vytvořené', ym: 'nabYM', fmt: function (v) { return String(Math.round(v)); }, scale: 'count' }
  ];

  function renderMesice(c) {
    return METRIKY.map(function (mt) { return mesicniTabulka(c, mt); }).join('');
  }
  function mesicniTabulka(c, mt) {
    var curYm = ymToIdx(c.year + '-' + ('0' + (c.curMonthIdx + 1)).slice(-2));
    var ymKey = function (k) { return Math.floor((k - 1) / 12) + '-' + ('0' + ((k - 1) % 12 + 1)).slice(-2); };
    var startIdx = {}, firstYm = curYm;
    c.rowsOZ.forEach(function (r) { startIdx[r[0]] = ymToIdx(c.start[r[0]]); firstYm = Math.min(firstYm, startIdx[r[0]]); });
    var months = [];
    for (var k = Math.max(firstYm, curYm - 11); k <= curYm; k++) months.push(k);
    var ord = c.rowsOZ.slice().sort(function (a, b) { return (c.ratC[b[0]] - c.ratC[a[0]]) || (c.ratQ[b[0]] - c.ratQ[a[0]]); });
    var ym = mt.pct ? null : c[mt.ym];
    var val = mt.pct ? function (d, key) { var o = c.obYM[d][key] || 0; return o > 0 ? (c.ziYM[d][key] || 0) / o * 100 : null; }
                     : function (d, key) { return ym[d][key] || 0; };
    var hi = 0, lo = null;
    ord.forEach(function (r) { months.forEach(function (kk) {
      if (kk < startIdx[r[0]] || kk === curYm) return;
      var v = val(r[0], ymKey(kk)); if (v === null) return;
      hi = Math.max(hi, v); lo = lo === null ? v : Math.min(lo, v);
    }); });
    function barva(v) {
      if (mt.pct) return heatColor(hi > lo ? (v - lo) / (hi - lo) : 1);
      return mt.scale === 'rel' ? heat3Rel(v, hi) : heatColor(hi > 0 ? v / hi : 0);
    }

    var h = ['<div class="sekce-m" id="m-' + mt.id + '"><h2>' + esc(mt.nazev) + '</h2><span>po měsících · ' + esc(mt.jednotka) + '</span></div>'];
    h.push('<div class="karta"><table class="mx"><thead><tr><th>Obchodník</th>' + months.map(function (kk) {
      var key = ymKey(kk);
      return '<th' + (kk === curYm ? ' class="akt" title="probíhající měsíc — zatím neúplný"' : '') + '>' +
             MONTH_LABELS[parseInt(key.substring(5, 7), 10) - 1] + ' ' + key.substring(2, 4) + (kk === curYm ? '<br><small>probíhá</small>' : '') + '</th>';
    }).join('') + '<th>Celkem</th></tr></thead><tbody>');
    var tymO = months.map(function () { return 0; }), tymZ = months.map(function () { return 0; }), tym = months.map(function () { return 0; });
    ord.forEach(function (r) {
      var d = r[0], s = 0, rO = 0, rZ = 0, alarm = {};
      if (mt.alarm) {
        var run = [];
        for (var kk = startIdx[d]; kk < curYm; kk++) {
          if ((ym[d][ymKey(kk)] || 0) < c.hranice) { run.push(kk); continue; }
          if (run.length >= ALERT_MIN_MONTHS) run.forEach(function (x) { alarm[x] = true; });
          run = [];
        }
        if (run.length >= ALERT_MIN_MONTHS) run.forEach(function (x) { alarm[x] = true; });
      }
      var row = '<tr><td class="oz">' + esc(d) + '</td>';
      months.forEach(function (kk, i) {
        if (kk < startIdx[d]) { row += '<td class="prazdne"></td>'; return; }
        var key = ymKey(kk), v = val(d, key), akt = kk === curYm ? ' akt' : '';
        if (mt.pct) {
          var o = c.obYM[d][key] || 0, z = c.ziYM[d][key] || 0;
          rO += o; rZ += z; tymO[i] += o; tymZ[i] += z;
          row += v === null ? '<td class="prazdne"></td>' : akt ? '<td class="akt">' + esc(mt.fmt(v)) + '</td>'
                                                                 : '<td class="h" style="background:' + barva(v) + '">' + esc(mt.fmt(v)) + '</td>';
          return;
        }
        s += v; tym[i] += v;
        row += alarm[kk] ? '<td class="alarm" title="2 a více uzavřených měsíců po sobě pod ' + vedMil(c.hranice) + '">' + esc(mt.fmt(v)) + '</td>'
             : akt ? '<td class="akt" title="probíhající měsíc — zatím neúplný, nehodnotí se">' + esc(mt.fmt(v)) + '</td>'
                   : '<td class="h" style="background:' + barva(v) + '">' + esc(mt.fmt(v)) + '</td>';
      });
      row += '<td class="cel">' + esc(mt.pct ? (rO > 0 ? mt.fmt(rZ / rO * 100) : '') : mt.fmt(s)) + '</td></tr>';
      h.push(row);
    });
    var tot = tym.reduce(function (a, b) { return a + b; }, 0), so = sum(tymO), sz = sum(tymZ);
    h.push('<tr class="tym"><td>Tým</td>' + months.map(function (kk, i) {
      return '<td>' + esc(mt.pct ? (tymO[i] > 0 ? mt.fmt(tymZ[i] / tymO[i] * 100) : '') : mt.fmt(tym[i])) + '</td>';
    }).join('') + '<td>' + esc(mt.pct ? (so > 0 ? mt.fmt(sz / so * 100) : '') : mt.fmt(tot)) + '</td></tr></tbody></table></div>');
    h.push('<div class="leg"><span>nižší</span><span class="grad"></span><span>vyšší</span>' +
      (mt.alarm ? '<span><span class="sw"></span>2 a více uzavřených měsíců po sobě pod ' + (c.hranice / 1000000).toFixed(1).replace('.', ',') + ' M</span>' : '') +
      '<span>šedý sloupec „probíhá“ = aktuální měsíc, zatím neúplný (nehodnotí se barvou)</span></div>');
    return h.join('');
  }
  function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }

  // ─────────────────────────── OKNO ⓘ ───────────────────────────
  function info(c) {
    return '<h2>Jak se počítá skóre</h2><div class="vahy"><div><b>' + c.W.obrat + ' %</b>obrat</div><div><b>' + c.W.zisk +
      ' %</b>zisk</div><div><b>' + c.W.schuzky + ' %</b>schůzky</div></div>' +
      '<p>Skóre 0–100 = vážený součet obratu, zisku a schůzek. Každá složka se porovná s nejlepším v týmu (nejlepší = plné body).</p>' +
      '<p><b>Celá doba</b> = od nástupu, <b>3 měsíce</b> = posledních 90 dní: průměr za měsíc (součet ÷ počet dní × 30), aby šli srovnat lidé s různě dlouhou dobou. <b>30 dní</b> = prostý součet.</p>' +
      '<p>Probíhající měsíc je neúplný, výhry se zapisují hlavně na konci měsíce. Zakázky bez částky nejsou započteny.</p>' +
      '<p style="color:var(--muted)">Data: snímek ' + vedDen(c.todayStr) + ' ' + esc(c.hhmm) + '.</p>';
  }

  // ─────────────────────────── ŘÍZENÍ ───────────────────────────
  var C = null, stav = { tab: 'skore', obdobi: 'cela' };
  function zHashe() {
    var p = location.hash.replace('#', '').split('/');
    if (p[0] === 'mesice') { stav.tab = 'mesice'; }
    else { stav.tab = 'skore'; if (p[1]) stav.obdobi = p[1]; }
  }
  function doHashe() { history.replaceState(null, '', '#' + stav.tab + (stav.tab === 'mesice' ? '' : '/' + stav.obdobi)); }
  function vykresli() {
    document.querySelectorAll('[data-tab]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-tab') === stav.tab)); });
    document.getElementById('obsah').innerHTML = stav.tab === 'mesice' ? renderMesice(C) : renderSkore(C, stav.obdobi);
    // úzká obrazovka: tabulky posunout na nejnovější měsíce
    document.querySelectorAll('.karta').forEach(function (k) { k.scrollLeft = k.scrollWidth; });
    doHashe();
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || !C) return;
    if (b.dataset.tab) { stav.tab = b.dataset.tab; vykresli(); window.scrollTo(0, 0); }
    else if (b.dataset.obdobi) { stav.obdobi = b.dataset.obdobi; vykresli(); }
  });
  var okno = document.getElementById('okno');
  document.getElementById('zavrit').addEventListener('click', function () { okno.close(); });
  okno.addEventListener('click', function (e) { if (e.target === okno) okno.close(); });
  document.getElementById('info').addEventListener('click', function () { if (C) okno.showModal(); });

  // ── přihlášení: heslo se pošle skriptu v Sheetu; když sedí, vrátí data. Zapamatuje se jen v tomto prohlížeči. ──
  var HESLO_KEY = 'dashboard_heslo';
  function ulozene() { try { return localStorage.getItem(HESLO_KEY) || ''; } catch (e) { return ''; } }
  function ulozit(h) { try { if (h) localStorage.setItem(HESLO_KEY, h); else localStorage.removeItem(HESLO_KEY); } catch (e) {} }
  var base = new URLSearchParams(location.search).get('api') || (window.DASH_CONFIG.API_URL + '?co=vedeni');
  function nacti(heslo) {
    var url = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'h=' + encodeURIComponent(heslo);
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (t) {
        var data; try { data = JSON.parse(t); } catch (e) { throw new Error('zdroj neodpověděl daty — je potřeba aktualizovat nasazení skriptu'); }
        if (data.chyba === 'heslo') { var err = new Error('Špatné heslo.'); err.heslo = true; throw err; }
        return data;
      });
  }
  function prihlaseni(zprava) {
    document.getElementById('stav').textContent = '';
    document.getElementById('odhlasit').hidden = true;
    document.getElementById('obsah').innerHTML = '<form class="login" id="login"><h2>Přihlášení</h2><p>Dashboard je chráněný heslem.</p>' +
      '<input type="password" id="heslo" autocomplete="current-password" placeholder="Heslo" aria-label="Heslo" required>' +
      '<button type="submit">Přihlásit</button><div class="err" role="alert">' + esc(zprava || '') + '</div></form>';
    var f = document.getElementById('login');
    document.getElementById('heslo').focus();
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var h = document.getElementById('heslo').value;
      f.querySelector('button').textContent = 'Ověřuji…';
      start(h);
    });
  }
  function start(heslo) {
    if (!heslo) { prihlaseni(''); return; }
    document.getElementById('obsah').innerHTML = '<div class="msg">Načítám data…</div>';
    nacti(heslo).then(function (data) {
      ulozit(heslo);
      C = kontext(data);
      document.getElementById('stav').textContent = 'stav k ' + vedDen(C.todayStr) + ' ' + C.hhmm;
      document.getElementById('oknoObsah').innerHTML = info(C);
      document.getElementById('odhlasit').hidden = false;
      vykresli();
    }).catch(function (err) {
      if (err.heslo) { ulozit(''); prihlaseni('Špatné heslo.'); return; }
      document.getElementById('obsah').innerHTML = '<div class="msg chyba">Data se nepodařilo načíst (' + esc(err.message) + ').</div>';
    });
  }
  window.addEventListener('hashchange', function () { if (C) { zHashe(); vykresli(); } });
  document.getElementById('odhlasit').addEventListener('click', function () { ulozit(''); C = null; prihlaseni(''); });
  zHashe();
  start(ulozene());
})();
