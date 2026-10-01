// Dashboard „Pro vedení" — stejná pravidla, pořadí, barvy a formáty jako list pro_vedeni v Sheetu.
// Data: poslední snímek ze Sheetu (JSON { sloupce, radky }), nic se neukládá.
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

  // ── vykreslení (stejně jako sestavProVedeni_ v Sheetu; váhy a metodika jsou v okně ℹ) ──
  var W_A = 100, W_X = 66;   // šířky sloupců jako v Sheetu
  function td(text, cls, bg, extra) {
    return '<td' + (cls ? ' class="' + cls + '"' : '') + ' style="' + (bg ? 'background:' + bg + ';' : '') + (extra || '') + '">' + esc(text) + '</td>';
  }
  function cols(widths) { return '<colgroup>' + widths.map(function (w) { return '<col style="width:' + w + 'px">'; }).join('') + '</colgroup>'; }
  function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }

  function render(c) {
    var curYm = ymToIdx(c.year + '-' + ('0' + (c.curMonthIdx + 1)).slice(-2));
    var ymKey = function (k) { return Math.floor((k - 1) / 12) + '-' + ('0' + ((k - 1) % 12 + 1)).slice(-2); };
    var startIdx = {}, firstYm = curYm;
    c.rowsOZ.forEach(function (r) { startIdx[r[0]] = ymToIdx(c.start[r[0]]); firstYm = Math.min(firstYm, startIdx[r[0]]); });
    var m0 = Math.max(firstYm, curYm - 11), months = [];
    for (var k = m0; k <= curYm; k++) months.push(k);
    var ord = c.rowsOZ.slice().sort(function (a, b) { return (c.ratC[b[0]] - c.ratC[a[0]]) || (c.ratQ[b[0]] - c.ratQ[a[0]]); });
    var out = [];

    // A · skóre podle období — 3 samostatné tabulky, každá seřazená podle svého skóre
    out.push('<div class="sekce">A · SKÓRE OBCHODNÍKŮ PODLE OBDOBÍ (každé období seřazeno podle svého skóre)</div><div class="radaA">');
    var dm = function (x) { return x.substring(8, 10) + '.' + x.substring(5, 7) + '.'; };
    var obdobi = [
      { k: 'c', r: c.ratC, t: 'CELÁ DOBA (od nástupu) · průměr za měsíc', bg: '#1F4E78', od: true, h: 'Ø/měs' },
      { k: 'q', r: c.ratQ, t: '3 MĚSÍCE (90 dní) · průměr za měsíc', bg: '#2E6DA4', od: false, h: 'Ø/měs' },
      { k: 'm', r: c.ratM, t: '30 DNÍ (' + dm(c.from30Str) + ' – ' + dm(c.todayStr) + ') · součet', bg: '#4A8BC2', od: false, h: '30 dní' }
    ];
    function mes(d, kk, key) { var x = c.win[d][kk]; return x[key] / x.dni * 30; }
    obdobi.forEach(function (p) {
      var hdr = ['Obchodník'].concat(p.od ? ['od'] : []).concat(['Skóre', 'Obrat ' + p.h, 'Zisk ' + p.h, 'Schůzky ' + p.h]);
      var widths = (p.od ? [W_A] : [82]).concat(hdr.slice(1).map(function () { return W_X; }));   // „Obchodník" se musí vejít
      var hi = { o: 0, z: 0, s: 0 };
      c.rowsOZ.forEach(function (r) { ['o', 'z', 's'].forEach(function (key) { hi[key] = Math.max(hi[key], mes(r[0], p.k, key)); }); });
      var poradi = c.rowsOZ.slice().sort(function (a, b) { return (p.r[b[0]] - p.r[a[0]]) || (c.ratC[b[0]] - c.ratC[a[0]]); });
      var t = ['<table class="t" style="width:' + sum(widths) + 'px;outline:2px solid ' + p.bg + ';outline-offset:-1px">' + cols(widths)];
      t.push('<tr>' + '<td class="grp" colspan="' + hdr.length + '" style="background:' + p.bg + '">' + esc(p.t) + '</td></tr>');
      t.push('<tr>' + hdr.map(function (h) { return td(h, 'hA'); }).join('') + '</tr>');
      poradi.forEach(function (r) {
        var d = r[0], st = c.start[d], o = mes(d, p.k, 'o'), z = mes(d, p.k, 'z'), sc = mes(d, p.k, 's');
        var row = td(d, 'oz');
        if (p.od) row += td(MONTH_LABELS[parseInt(st.substring(5, 7), 10) - 1] + ' ' + st.substring(2, 4), 'od');
        row += td(p.r[d], 'sk', heatColorRich(p.r[d] / 100)) + td(vedMil(o), 'n', heat3Rel(o, hi.o)) + td(vedMil(z), 'n', heat3Rel(z, hi.z)) +
               td(String(Math.round(sc)), 'n', heatColor(hi.s > 0 ? sc / hi.s : 0));
        t.push('<tr>' + row + '</tr>');
      });
      t.push('</table>');
      out.push(t.join(''));
    });
    out.push('</div>');

    // B–F · měsíční matice (stejná stavba)
    var tis = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); };
    function mesicniBlok(title, ym, fmt, scale, alarmOn, pct) {
      out.push('<div class="sekce">' + esc(title) + '</div>');
      var hdr = ['Obchodník'].concat(months.map(function (kk) {
        var key = ymKey(kk);
        return MONTH_LABELS[parseInt(key.substring(5, 7), 10) - 1] + ' ' + key.substring(2, 4) + (kk === curYm ? '*' : '');
      })).concat(['celkem']);
      var widths = [W_A].concat(hdr.slice(1).map(function () { return W_X; }));
      var t = ['<table class="t" style="width:' + sum(widths) + 'px">' + cols(widths)];
      t.push('<tr>' + hdr.map(function (h) { return td(h, 'hM'); }).join('') + '</tr>');
      var val = pct ? function (d, key) { var o = ym.o[d][key] || 0; return o > 0 ? (ym.z[d][key] || 0) / o * 100 : null; }
                    : function (d, key) { return ym[d][key] || 0; };
      var hi = 0, lo = null;
      ord.forEach(function (r) { months.forEach(function (kk) {
        if (kk < startIdx[r[0]]) return;
        var v = val(r[0], ymKey(kk)); if (v === null) return;
        hi = Math.max(hi, v); lo = lo === null ? v : Math.min(lo, v);
      }); });
      var tymO = months.map(function () { return 0; }), tymZ = months.map(function () { return 0; }), tym = months.map(function () { return 0; });
      var sumO = 0, sumZ = 0;
      ord.forEach(function (r) {
        var d = r[0], row = td(d, 'oz'), s = 0, alarm = {}, rO = 0, rZ = 0;
        if (alarmOn) {
          var run = [];
          for (var kk = startIdx[d]; kk < curYm; kk++) {
            if ((ym[d][ymKey(kk)] || 0) < c.hranice) { run.push(kk); continue; }
            if (run.length >= ALERT_MIN_MONTHS) run.forEach(function (x) { alarm[x] = true; });
            run = [];
          }
          if (run.length >= ALERT_MIN_MONTHS) run.forEach(function (x) { alarm[x] = true; });
        }
        months.forEach(function (kk, i) {
          if (kk < startIdx[d]) { row += td('', ''); return; }
          var key = ymKey(kk), v = val(d, key);
          if (pct) {
            var o = ym.o[d][key] || 0, z = ym.z[d][key] || 0;
            rO += o; rZ += z; tymO[i] += o; tymZ[i] += z;
            row += v === null ? td('', 'n') : td(fmt(v), 'n', heatColor(hi > lo ? (v - lo) / (hi - lo) : 1));
            return;
          }
          s += v; tym[i] += v;
          row += alarm[kk] ? td(fmt(v), 'n alarm') : td(fmt(v), 'n', scale === 'rel' ? heat3Rel(v, hi) : heatColor(hi > 0 ? v / hi : 0));
        });
        row += td(pct ? (rO > 0 ? fmt(rZ / rO * 100) : '') : fmt(s), 'n cel');
        sumO += rO; sumZ += rZ;
        t.push('<tr>' + row + '</tr>');
      });
      var tot = sum(tym), teamRow = td('TÝM', 'tym oz');
      if (pct) teamRow += months.map(function (kk, i) { return td(tymO[i] > 0 ? fmt(tymZ[i] / tymO[i] * 100) : '', 'tym n'); }).join('') +
                          td(sumO > 0 ? fmt(sumZ / sumO * 100) : '', 'tym n');
      else teamRow += tym.map(function (v) { return td(fmt(v), 'tym n'); }).join('') + td(fmt(tot), 'tym n');
      t.push('<tr>' + teamRow + '</tr></table>');
      out.push(t.join(''));
    }
    mesicniBlok('B · OBRAT PO MĚSÍCÍCH (M Kč) · tmavě červená = 2 a více uzavřených měsíců po sobě pod ' +
                (c.hranice / 1000000).toFixed(1).replace('.', ',') + ' M · * probíhající měsíc',
                c.obYM, function (v) { return (v / 1000000).toFixed(1).replace('.', ','); }, 'rel', true);
    mesicniBlok('C · ZISK PO MĚSÍCÍCH (tis. Kč) · * probíhající měsíc', c.ziYM, function (v) { return tis(v / 1000); }, 'rel', false);
    mesicniBlok('D · MARŽE PO MĚSÍCÍCH (zisk ÷ obrat, %) · * probíhající měsíc', { o: c.obYM, z: c.ziYM },
                function (v) { return Math.round(v) + ' %'; }, 'pct', false, true);
    mesicniBlok('E · SCHŮZKY PO MĚSÍCÍCH (realizované) · * probíhající měsíc', c.scYM, function (v) { return String(Math.round(v)); }, 'count', false);
    mesicniBlok('F · VYTVOŘENÉ NABÍDKY PO MĚSÍCÍCH · * probíhající měsíc', c.nabYM, function (v) { return String(Math.round(v)); }, 'count', false);
    return out.join('');
  }

  // ── informační okno: váhy a metodika (v Sheetu byly jako poznámky na listu) ──
  function info(c) {
    return '<h2>Jak se počítá skóre</h2>' +
      '<table><tr><td>Obrat</td><td><b>' + c.W.obrat + ' %</b></td></tr><tr><td>Zisk</td><td><b>' + c.W.zisk +
      ' %</b></td></tr><tr><td>Schůzky</td><td><b>' + c.W.schuzky + ' %</b></td></tr></table>' +
      '<p>Skóre 0–100 = vážený průměr obratu, zisku a schůzek, každá hodnota vůči nejlepšímu v týmu (nejlepší = 100).</p>' +
      '<p>Obrat, zisk a schůzky vedle skóre jsou přesně ta čísla, ze kterých se skóre počítá: u celé doby a 3 měsíců průměr ' +
      'za měsíc (Ø/měs = součet ÷ počet dní × 30), u 30 dní prostý součet za 30 dní.</p>' +
      '<p>Celá doba = od nástupu, 3 měsíce = posledních 90 dní. Probíhající měsíc je neúplný, výhry se zapisují hlavně na konci měsíce. ' +
      'Zakázky bez částky nejsou započteny.</p>' +
      '<p>Data: snímek ' + vedDen(c.todayStr) + ' ' + esc(c.hhmm) + '.</p>';
  }

  var okno = document.getElementById('okno');
  document.getElementById('zavrit').addEventListener('click', function () { okno.close(); });
  okno.addEventListener('click', function (e) { if (e.target === okno) okno.close(); });

  var api = new URLSearchParams(location.search).get('api') || (window.DASH_CONFIG.API_URL + '?co=vedeni');
  fetch(api).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (data) {
      var c = kontext(data);
      document.getElementById('stav').textContent = 'stav k ' + vedDen(c.todayStr) + ' ' + c.hhmm;
      document.getElementById('obsah').innerHTML = render(c);
      document.getElementById('oknoObsah').innerHTML = info(c);
      document.getElementById('info').addEventListener('click', function () { okno.showModal(); });
    })
    .catch(function (err) {
      document.getElementById('stav').textContent = '';
      document.getElementById('obsah').innerHTML = '<div class="chyba">Data se nepodařilo načíst (' + esc(err.message) +
        '). Zdroj v Sheetu je možná potřeba znovu nasadit.</div>';
    });
})();
