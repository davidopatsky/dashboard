// Dashboard výkonu obchodníků — data z posledního snímku v Sheetu (JSON { sloupce, radky }), nic se neukládá.
// Výpočty, pořadí a barevné škály jsou stejné jako ve skriptu v Sheetu; vzhled je vlastní (tmavý dashboard).
//   Záložka Skóre: jedno období na obrazovku (celá doba / 3 měsíce / 30 dní), u každého skóre jeho složky.
//   Záložka Měsíční data: obrat, zisk, marže, schůzky a nabídky po měsících pod sebou (scroll), celý rok led–pro;
//   pod nimi leady a konverze (kanál A+B vs. OP od Sabiny) — počítané tady z „faktů" (?co=fakta) ze Sheetu.
//   Sheet obnovuje vždy všechna data najednou; když obchody a leady přesto nejsou ze stejného stažení jako
//   snímek (obnova nedoběhla), konverze se nezobrazí — místo zkreslených čísel je výzva k obnově.
// Přístup: heslo ověřuje skript v Sheetu (?co=vedeni&h=…, ?co=fakta&h=…); stránka heslo nezná, jen ho pošle.
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
  // Syté barvy stejné jako v Sheetu; číslo na nich je tmavé a tučné (kontrast ≥ 7 : 1).
  function bg(hex) { return 'background:' + hex; }
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
        c.win[d][w[0]] = { dni: num(r, w[1] + '_dni') || 1, o: num(r, w[1] + '_obrat'), z: num(r, w[1] + '_zisk'), s: num(r, w[1] + '_schuzky'),
                           n: num(r, w[1] + '_nabidky'), w: num(r, w[1] + '_vyhry') };
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
    { id: 'cela', k: 'c', nazev: 'Celá doba', kratce: 'Celá', r: 'ratC', h: 'Ø za měsíc', popis: function (c) { return 'od nástupu každého obchodníka · hodnoty jsou průměr za měsíc'; } },
    { id: '3m', k: 'q', nazev: '3 měsíce', kratce: '3 měs.', r: 'ratQ', h: 'Ø za měsíc', popis: function (c) { return 'posledních 90 dní · hodnoty jsou průměr za měsíc'; } },
    { id: '30d', k: 'm', nazev: '30 dní', kratce: '30 d.', r: 'ratM', h: 'za 30 dní', popis: function (c) { return dmy(c.from30Str) + ' – ' + dmy(c.todayStr) + ' · hodnoty jsou součet za 30 dní'; } }
  ];
  function dmy(iso) { return parseInt(iso.substring(8, 10), 10) + '. ' + parseInt(iso.substring(5, 7), 10) + '.'; }
  function tisM(v) { return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

  function renderSkore(c, obdobiId) {
    var p = OBDOBI.filter(function (o) { return o.id === obdobiId; })[0] || OBDOBI[0];
    var R = c[p.r];
    function mes(d, key) { var x = c.win[d][p.k]; return x[key] / x.dni * 30; }
    var slozky = [{ key: 'o', nazev: 'Obrat', kde: 'obratu', w: c.W.obrat, fmt: vedMil }, { key: 'z', nazev: 'Zisk', kde: 'zisku', w: c.W.zisk, fmt: vedMil },
                  { key: 's', nazev: 'Schůzky', kde: 'schůzkách', w: c.W.schuzky, fmt: function (v) { return String(Math.round(v)); } }];
    var hi = {};
    slozky.forEach(function (s) { hi[s.key] = Math.max.apply(null, c.rowsOZ.map(function (r) { return mes(r[0], s.key); }).concat([0])); });
    var poradi = c.rowsOZ.slice().sort(function (a, b) { return (R[b[0]] - R[a[0]]) || (c.ratC[b[0]] - c.ratC[a[0]]); });
    var ostatni = OBDOBI.filter(function (o) { return o.id !== p.id; });
    var jed = p.id === '30d' ? '30 dní' : 'Ø/měs';
    var des1 = function (v) { return (Math.round(v * 10) / 10).toFixed(1).replace('.', ','); };

    var h = ['<div class="bar"><div class="seg" role="group" aria-label="Období">' +
      OBDOBI.map(function (o) { return '<button type="button" data-obdobi="' + o.id + '" aria-pressed="' + (o.id === p.id) + '">' + o.nazev + '</button>'; }).join('') +
      '</div><span class="pozn">' + esc(p.popis(c)) + '</span></div>'];
    h.push('<div class="tw"><table class="g"><thead>' +
      '<tr class="grp"><th class="st" colspan="3"></th>' +
      slozky.map(function (s) { return '<th class="sep" colspan="3">' + s.nazev + ' <span class="w">· váha ' + s.w + ' %</span></th>'; }).join('') +
      '<th class="sep" colspan="4">Podklady · ' + jed + '</th><th class="sep">Proč</th><th class="sep" colspan="' + ostatni.length + '">Skóre jinde</th></tr>' +
      '<tr><th class="c st r0">#</th><th class="l st r1">Obchodník</th><th class="c st r2">Skóre</th>' +
      slozky.map(function () { return '<th class="sep">' + jed + '</th><th>vs. nejlepší</th><th>body</th>'; }).join('') +
      '<th class="sep" title="Počet výher">Výhry</th><th title="Obrat ÷ počet výher">Ø zakázka</th><th title="Zisk ÷ obrat">Marže</th><th title="Vytvořené nabídky">Nabídky</th>' +
      '<th class="sep l" title="▼ kde ztrácí nejvíc bodů · ▲ v čem je nejlepší v týmu">▼ ztrácí · ▲ vede</th>' +
      ostatni.map(function (o, i) { return '<th class="c' + (i ? '' : ' sep') + '" title="' + o.nazev + '">' + o.kratce + '</th>'; }).join('') +
      '</tr></thead><tbody>');
    poradi.forEach(function (r, i) {
      var d = r[0], st = c.start[d], x = c.win[d][p.k];
      var row = '<tr><td class="c st r0 poradi">' + (i + 1) + '</td>' +
        '<td class="l st r1 oz">' + esc(d) + '<small>od ' + MONTH_LABELS[parseInt(st.substring(5, 7), 10) - 1] + ' ' + st.substring(0, 4) + '</small></td>' +
        '<td class="c st r2"><span class="chip" style="' + bg(heatColorRich(R[d] / 100)) + '">' + R[d] + '</span></td>';
      var ztraty = [], vede = [];
      slozky.forEach(function (s) {
        var v = mes(d, s.key), podil = hi[s.key] > 0 ? v / hi[s.key] : 0, body = Math.round(podil * s.w);
        var barva = s.key === 's' ? heatColor(podil) : heat3Rel(v, hi[s.key]);
        row += '<td class="sep"><b>' + esc(s.fmt(v)) + '</b></td>' +
               '<td><div class="pct"><span class="tr"><i style="width:' + Math.max(3, podil * 100) + '%;background:' + barva + '"></i></span>' + Math.round(podil * 100) + ' %</div></td>' +
               '<td class="body"><b>' + body + '</b>/' + s.w + '</td>';
        if (podil >= 0.995) vede.push(s.nazev.toLowerCase()); else ztraty.push({ s: s, b: s.w - body });
      });
      var vyhry = x.w, prumer = vyhry > 0 ? x.o / vyhry : 0, marze = x.o > 0 ? Math.round(x.z / x.o * 100) + ' %' : '–';
      row += '<td class="sep">' + des1(mes(d, 'w')) + '</td><td>' + (prumer ? vedMil(prumer) : '–') + '</td><td>' + marze + '</td><td>' + des1(mes(d, 'n')) + '</td>';
      ztraty.sort(function (a, b) { return b.b - a.b; });
      var proc = [];
      if (ztraty.length && ztraty[0].b >= 1) proc.push('<span class="z" title="Nejvíc bodů ztrácí na ' + ztraty[0].s.kde + '">▼ ' + ztraty[0].s.nazev.toLowerCase() + ' −' + ztraty[0].b + ' b.</span>');
      if (vede.length) proc.push('<span class="p" title="Nejlepší v týmu">▲ nejlepší: ' + vede.join(', ') + '</span>');
      row += '<td class="sep proc">' + (proc.join('<br>') || '<span class="muted">vyrovnaný</span>') + '</td>';
      row += ostatni.map(function (o, k) { return '<td class="c' + (k ? '' : ' sep') + '"><span class="chip s" style="' + bg(heatColorRich(c[o.r][d] / 100)) + '">' + c[o.r][d] + '</span></td>'; }).join('');
      h.push(row + '</tr>');
    });
    h.push('</tbody></table></div>');
    return h.join('');
  }

  // ─────────────────────────── MĚSÍČNÍ DATA ───────────────────────────
  var METRIKY = [
    { id: 'obrat', nazev: 'Obrat', jednotka: 'Kč bez DPH', ym: 'obYM', fmt: function (v) { return v ? vedMil(v) : '0'; }, scale: 'rel', alarm: true },
    { id: 'zisk', nazev: 'Zisk', jednotka: 'Kč bez DPH', ym: 'ziYM', fmt: function (v) { return v ? vedMil(v) : '0'; }, scale: 'rel' },
    { id: 'marze', nazev: 'Marže', jednotka: '% (zisk ÷ obrat)', pct: true, fmt: function (v) { return Math.round(v) + ' %'; } },
    { id: 'schuzky', nazev: 'Schůzky', jednotka: 'realizované', ym: 'scYM', fmt: function (v) { return String(Math.round(v)); }, scale: 'count' },
    { id: 'nabidky', nazev: 'Nabídky', jednotka: 'vytvořené', ym: 'nabYM', fmt: function (v) { return String(Math.round(v)); }, scale: 'count' }
  ];

  function renderMesice(c) {
    return '<div class="skupina" style="margin-top:0;border-top:0;padding-top:0">Výkon · snímek ' + vedDen(c.todayStr) + ' ' + esc(c.hhmm) + '</div>' +
      METRIKY.map(function (mt) { return mesicniTabulka(c, mt); }).join('') + renderLeady(c, FAKTA);
  }
  function mesicniTabulka(c, mt) {
    var curYm = ymToIdx(c.year + '-' + ('0' + (c.curMonthIdx + 1)).slice(-2));
    var ymKey = function (k) { return Math.floor((k - 1) / 12) + '-' + ('0' + ((k - 1) % 12 + 1)).slice(-2); };
    var startIdx = {};
    c.rowsOZ.forEach(function (r) { startIdx[r[0]] = ymToIdx(c.start[r[0]]); });
    var months = rokMesice(c);   // vždy celý rok led–pro; budoucí měsíce prázdné
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
    h.push('<div class="tw"><table class="g mx"><thead><tr><th class="l st">Obchodník</th>' + hlavickaMesicu(months, curYm) + '<th class="sep">Celkem</th></tr></thead><tbody>');
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
      var row = '<tr><td class="l st oz">' + esc(d) + '</td>';
      months.forEach(function (kk, i) {
        if (kk > curYm) { row += '<td class="bud"></td>'; return; }
        if (kk < startIdx[d]) { row += '<td class="dim"></td>'; return; }
        var key = ymKey(kk), v = val(d, key), akt = kk === curYm ? ' akt' : '';
        if (mt.pct) {
          var o = c.obYM[d][key] || 0, z = c.ziYM[d][key] || 0;
          rO += o; rZ += z; tymO[i] += o; tymZ[i] += z;
          row += v === null ? '<td class="dim"></td>' : akt ? '<td class="akt">' + esc(mt.fmt(v)) + '</td>'
                                                                 : '<td class="h" style="' + bg(barva(v)) + '">' + esc(mt.fmt(v)) + '</td>';
          return;
        }
        s += v; tym[i] += v;
        row += alarm[kk] ? '<td class="alarm" title="2 a více uzavřených měsíců po sobě pod ' + vedMil(c.hranice) + '">' + esc(mt.fmt(v)) + '</td>'
             : akt ? '<td class="akt" title="probíhající měsíc — zatím neúplný, nehodnotí se">' + esc(mt.fmt(v)) + '</td>'
                   : '<td class="h" style="' + bg(barva(v)) + '">' + esc(mt.fmt(v)) + '</td>';
      });
      row += '<td class="cel sep">' + esc(mt.pct ? (rO > 0 ? mt.fmt(rZ / rO * 100) : '') : mt.fmt(s)) + '</td></tr>';
      h.push(row);
    });
    var tot = tym.reduce(function (a, b) { return a + b; }, 0), so = sum(tymO), sz = sum(tymZ);
    h.push('<tr class="tym"><td class="l st">Tým</td>' + months.map(function (kk, i) {
      if (kk > curYm) return '<td class="bud"></td>';
      return '<td>' + esc(mt.pct ? (tymO[i] > 0 ? mt.fmt(tymZ[i] / tymO[i] * 100) : '') : mt.fmt(tym[i])) + '</td>';
    }).join('') + '<td class="sep">' + esc(mt.pct ? (so > 0 ? mt.fmt(sz / so * 100) : '') : mt.fmt(tot)) + '</td></tr></tbody></table></div>');
    return h.join('');
  }
  function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
  function rokMesice(c) { var m = []; for (var i = 1; i <= 12; i++) m.push(c.year * 12 + i); return m; }
  function hlavickaMesicu(months, curYm) {
    return months.map(function (kk) {
      var mi = (kk - 1) % 12, yy = String(Math.floor((kk - 1) / 12)).substring(2);
      var cls = kk === curYm ? 'mes akt' : kk > curYm ? 'mes bud' : 'mes';
      return '<th class="' + cls + '"' + (kk === curYm ? ' title="probíhající měsíc — zatím neúplný"' : '') + '>' +
             MONTH_LABELS[mi] + ' ' + yy + (kk === curYm ? '<small>probíhá</small>' : '') + '</th>';
    }).join('');
  }


  // ─────────────────── LEADY A KONVERZE (kanál A+B vs. OP od Sabiny) ───────────────────
  // Zdroj = „fakta" ze Sheetu: počty po osobě × měsíci, uložené při každé obnově dat (obchody, leady)
  // i s časem stažení. Konverze se počítají tady.
  var SABINA = 'Sabina Kratochvíl';
  function faktaIndex(F) {
    var x = {};   // x[metrika][osoba][ymIdx]; osoba = zobrazované jméno OZ, jinak plné jméno vlastníka
    F.radky.forEach(function (r) {
      var kdo = r[2] || r[1], rok = Number(r[4]);
      var o = (x[r[3]] = x[r[3]] || {}), q = (o[kdo] = o[kdo] || {});
      for (var i = 0; i < 12; i++) if (r[5 + i]) q[rok * 12 + i + 1] = (q[rok * 12 + i + 1] || 0) + Number(r[5 + i]);
    });
    return x;
  }
  function kdy(s) { return s ? parseInt(s.substring(8, 10), 10) + '. ' + parseInt(s.substring(5, 7), 10) + '. ' + s.substring(11, 16) : 'nikdy'; }

  function renderLeady(c, F) {
    var h = ['<div class="skupina">Leady a konverze · kanál A+B vs. OP od Sabiny</div>'];
    var obnov = 'V Sheetu klikni <b>📊 Dashboard → 🔄 Obnovit data pro dashboard</b> (nebo počkej na noční obnovu).';
    if (!F) return h.join('') + '<div class="nic">Leady a konverze se zobrazí po první obnově dat. ' + obnov + '</div>';
    var st = F.stav || {}, den = function (k) { return String(st[k] || '').substring(0, 10); };
    if (den('obchody') !== c.todayStr || den('leady') !== c.todayStr) {
      return h.join('') + '<div class="nic varovani">⚠ Leady a konverze nejsou ze stejného stažení jako zbytek dashboardu ' +
        '(snímek ' + esc(vedDen(c.todayStr)) + ', obchody ' + esc(kdy(st.obchody)) + ', leady ' + esc(kdy(st.leady)) + '), konverze by byla zkreslená. ' + obnov + '</div>';
    }
    var x = faktaIndex(F), curYm = c.year * 12 + c.curMonthIdx + 1, months = rokMesice(c);
    var ord = c.rowsOZ.slice().sort(function (a, b) { return (c.ratC[b[0]] - c.ratC[a[0]]) || (c.ratQ[b[0]] - c.ratQ[a[0]]); }).map(function (r) { return r[0]; });
    var jeOZ = {}; ord.forEach(function (d) { jeOZ[d] = true; });
    var g = function (met, kdo, k) { return ((x[met] || {})[kdo] || {})[k] || 0; };
    var g2 = function (met, kdos, k) { return kdos.reduce(function (s, kdo) { return s + g(met, kdo, k); }, 0); };
    var ostatni = function (met) { return Object.keys(x[met] || {}).filter(function (kdo) { return !jeOZ[kdo] && kdo !== SABINA; }).sort(); };
    var start = {}; ord.forEach(function (d) { start[d] = ymToIdx(c.start[d]); });
    var pocet = function (v) { return String(Math.round(v)); }, proc = function (v) { return Math.round(v * 100) + ' %'; };

    // Přidělené leady A+B — validní leady (fáze ≠ Zrušený), vlastník = OZ; Tým = všechny validní leady firmy
    var ostL = ostatni('leady_validni'), vsiL = ord.concat([SABINA], ostL);
    h.push(tabulka(c, months, curYm, {
      nazev: 'Přidělené leady A+B', popis: 'validní leady (bez zrušených), vlastník = obchodník · zelená = méně leadů',
      typ: 'pocet', obracene: true, fmt: pocet, start: start,
      radky: ord.map(function (d) { return { nazev: d, oz: true, v: function (k) { return g('leady_validni', d, k); } }; })
        .concat([{ nazev: 'Sabina (pre-sales)', v: function (k) { return g('leady_validni', SABINA, k); } }])
        .concat(ostL.length ? [{ nazev: 'Ostatní', title: ostL.join(', '), v: function (k) { return g2('leady_validni', ostL, k); } }] : []),
      tym: function (k) { return g2('leady_validni', vsiL, k); }, tymNazev: 'Tým (celá firma)'
    }));
    // Konverze A+B = (výhry − vyhraná OP od Sabiny) ÷ validní leady; Tým = jen obchodníci
    var konvAB = function (kdos) { return function (k) {
      var l = g2('leady_validni', kdos, k); return { n: g2('vyhry', kdos, k) - g2('op_sabina_vyhra', kdos, k), d: l }; }; };
    h.push(tabulka(c, months, curYm, {
      nazev: 'Konverze A+B', popis: '(výhry − vyhraná OP od Sabiny) ÷ validní leady · měsíční % je orientační, spolehlivý je součet',
      typ: 'podil', fmt: proc, start: start,
      radky: ord.map(function (d) { return { nazev: d, oz: true, p: konvAB([d]) }; }),
      tym: konvAB(ord), tymNazev: 'Tým (obchodníci)'
    }));
    // Přidělené OP od Sabiny — kategorie S-zaměření, jakýkoli stav, měsíc dle otevření OP
    var ostS = ostatni('op_sabina'), vsiS = ord.concat(ostS);
    h.push(tabulka(c, months, curYm, {
      nazev: 'Přidělené OP od Sabiny', popis: 'obchodní případy kategorie S-zaměření (jakýkoli stav), měsíc dle otevření · zelená = méně',
      typ: 'pocet', obracene: true, fmt: pocet, start: start,
      radky: ord.map(function (d) { return { nazev: d, oz: true, v: function (k) { return g('op_sabina', d, k); } }; })
        .concat(ostS.length ? [{ nazev: 'Ostatní', title: ostS.join(', '), v: function (k) { return g2('op_sabina', ostS, k); } }] : []),
      tym: function (k) { return g2('op_sabina', vsiS, k); }, tymNazev: 'Tým'
    }));
    // Konverze OP od Sabiny = vyhraná ÷ přidělená (obojí dle měsíce otevření OP)
    var konvS = function (kdos) { return function (k) { return { n: g2('op_sabina_vyhra', kdos, k), d: g2('op_sabina', kdos, k) }; }; };
    h.push(tabulka(c, months, curYm, {
      nazev: 'Konverze OP od Sabiny', popis: 'vyhraná ÷ přidělená OP od Sabiny, měsíc dle otevření OP',
      typ: 'podil', fmt: proc, start: start,
      radky: ord.map(function (d) { return { nazev: d, oz: true, p: konvS([d]) }; })
        .concat(ostS.length ? [{ nazev: 'Ostatní', title: ostS.join(', '), p: konvS(ostS) }] : []),
      tym: konvS(vsiS), tymNazev: 'Tým'
    }));
    return h.join('');
  }

  // Obecná měsíční tabulka nad fakty: typ 'pocet' (v(k) → číslo) nebo 'podil' (p(k) → {n, d}, zobrazí n ÷ d).
  // Barva jen u obchodníků, v uzavřených měsících od nástupu; probíhající měsíc neutrálně, budoucí prázdné.
  // Podíly (konverze) mají měsíčně extrémy (výhra a lead padnou do jiných měsíců), proto barva vůči týmu:
  // žlutá = týmová hodnota za celý rok, zelená = dvojnásobek a víc, červená = blízko nule.
  function tabulka(c, months, curYm, t) {
    var hodnota = function (r, k) { if (t.typ === 'pocet') return r.v(k); var q = r.p(k); return q.d > 0 ? q.n / q.d : null; };
    var ref = null;
    if (t.typ === 'podil') {
      var rn = 0, rd = 0;
      months.forEach(function (k) { if (k <= curYm) { var q = t.tym(k); rn += q.n; rd += q.d; } });
      ref = rd > 0 && rn > 0 ? rn / rd : null;
    }
    var hi = null, lo = null;
    t.radky.forEach(function (r) { if (!r.oz) return; months.forEach(function (k) {
      if (k >= curYm || k < t.start[r.nazev]) return;
      var v = hodnota(r, k); if (v === null) return;
      hi = hi === null ? v : Math.max(hi, v); lo = lo === null ? v : Math.min(lo, v);
    }); });
    function barva(v) {
      var f = t.typ === 'pocet' ? (hi > 0 ? v / hi : 0) : (ref ? v / (2 * ref) : 0.5);
      return heatColor(t.obracene ? 1 - f : f);
    }
    function celkem(r) {
      var ks = months.filter(function (k) { return k <= curYm; });
      if (t.typ === 'pocet') return t.fmt(ks.reduce(function (s, k) { return s + r.v(k); }, 0));
      var n = 0, d = 0; ks.forEach(function (k) { var q = r.p(k); n += q.n; d += q.d; });
      return d > 0 ? t.fmt(n / d) : '–';
    }
    var h = ['<div class="sekce-m"><h2>' + esc(t.nazev) + '</h2><span>' + esc(t.popis) + '</span></div>'];
    h.push('<div class="tw"><table class="g mx"><thead><tr><th class="l st">Obchodník</th>' + hlavickaMesicu(months, curYm) + '<th class="sep">Celkem</th></tr></thead><tbody>');
    t.radky.forEach(function (r) {
      var row = '<tr' + (r.oz ? '' : ' class="ost"') + '><td class="l st oz"' + (r.title ? ' title="' + esc(r.title) + '"' : '') + '>' + esc(r.nazev) + '</td>';
      months.forEach(function (k) {
        if (k > curYm) { row += '<td class="bud"></td>'; return; }
        var v = hodnota(r, k), txt = v === null ? '–' : t.fmt(v);
        if (k === curYm) row += '<td class="akt" title="probíhající měsíc — zatím neúplný">' + esc(txt) + '</td>';
        else if (!r.oz || v === null || k < t.start[r.nazev] || hi === null) row += '<td>' + esc(txt) + '</td>';
        else row += '<td class="h" style="' + bg(barva(v)) + '">' + esc(txt) + '</td>';
      });
      h.push(row + '<td class="cel sep">' + esc(celkem(r)) + '</td></tr>');
    });
    var T = t.typ === 'pocet' ? { v: t.tym } : { p: t.tym };
    h.push('<tr class="tym"><td class="l st">' + esc(t.tymNazev) + '</td>' + months.map(function (k) {
      if (k > curYm) return '<td class="bud"></td>';
      var v = hodnota(T, k); return '<td>' + esc(v === null ? '–' : t.fmt(v)) + '</td>';
    }).join('') + '<td class="sep">' + esc(celkem(T)) + '</td></tr></tbody></table></div>');
    return h.join('');
  }

  // ─────────────────────────── OKNO ⓘ ───────────────────────────
  function info(c) {
    return '<h2>Jak se počítá skóre</h2><div class="vahy"><div><b>' + c.W.obrat + ' %</b>obrat</div><div><b>' + c.W.zisk +
      ' %</b>zisk</div><div><b>' + c.W.schuzky + ' %</b>schůzky</div></div>' +
      '<p>Skóre 0–100 = vážený součet obratu, zisku a schůzek. Každá složka se porovná s nejlepším v týmu (nejlepší = plné body).</p>' +
      '<p><b>Celá doba</b> = od nástupu, <b>3 měsíce</b> = posledních 90 dní: průměr za měsíc (součet ÷ počet dní × 30), aby šli srovnat lidé s různě dlouhou dobou. <b>30 dní</b> = prostý součet.</p>' +
      '<p>Probíhající měsíc je neúplný, výhry se zapisují hlavně na konci měsíce. Zakázky bez částky nejsou započteny.</p>' +
      '<p><b>Měsíční data:</b> barva = srovnání v rámci tabulky (zelená vyšší, červená nižší). Sytě červený obrat = 2 a více uzavřených měsíců po sobě pod ' +
      vedMil(c.hranice) + '. Šedý sloupec „probíhá“ = aktuální měsíc, zatím se nehodnotí.</p>' +
      '<p><b>Data</b> se v Sheetu obnovují vždy celá najednou — každou noc mezi 5. a 6. hodinou, nebo tlačítkem 📊 Dashboard → 🔄 Obnovit data pro dashboard. ' +
      'Kdyby obnova nedoběhla a leady s obchody nebyly ze stejného stažení, konverze se nezobrazí (byla by zkreslená).</p><p><b>Leady a konverze:</b> ' +
      'Konverze A+B = (výhry − vyhraná OP od Sabiny) ÷ validní leady; u přidělených leadů a OP od Sabiny je zelená ten, kdo jich má méně. U konverzí je žlutá = týmová konverze za rok, zelená = dvojnásobek a víc. Sloupec Celkem u konverzí = ze součtů, ne průměr procent.</p>' +
      '<p><b>Podklady u skóre:</b> výhry = počet vyhraných zakázek, Ø zakázka = obrat ÷ výhry, marže = zisk ÷ obrat, nabídky = vytvořené nabídky.</p>' +
      '<p style="color:var(--muted)">Data: snímek ' + vedDen(c.todayStr) + ' ' + esc(c.hhmm) + '.</p>';
  }

  // ─────────────────────────── ŘÍZENÍ ───────────────────────────
  var C = null, FAKTA = null, stav = { tab: 'skore', obdobi: 'cela' };
  function zHashe() {
    var p = location.hash.replace('#', '').split('/');
    if (p[0] === 'mesice') { stav.tab = 'mesice'; }
    else { stav.tab = 'skore'; if (p[1]) stav.obdobi = p[1]; }
  }
  function doHashe() { history.replaceState(null, '', '#' + stav.tab + (stav.tab === 'mesice' ? '' : '/' + stav.obdobi)); }
  function vykresli() {
    document.querySelectorAll('[data-tab]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-tab') === stav.tab)); });
    document.getElementById('obsah').innerHTML = stav.tab === 'mesice' ? renderMesice(C) : renderSkore(C, stav.obdobi);
    // úzká obrazovka: tabulky posunout tak, aby byl vidět probíhající měsíc
    document.querySelectorAll('table.mx').forEach(function (t) {
      var k = t.parentNode, a = t.querySelector('th.akt');
      if (a && k.scrollWidth > k.clientWidth) k.scrollLeft = Math.max(0, a.offsetLeft + a.offsetWidth + 8 - k.clientWidth);
    });
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
  var Q = new URLSearchParams(location.search);
  var base = Q.get('api') || (window.DASH_CONFIG.API_URL + '?co=vedeni');
  var baseFakta = Q.get('fakta') || (window.DASH_CONFIG.API_URL + '?co=fakta');
  function sHeslem(u, heslo) { return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'h=' + encodeURIComponent(heslo); }
  // fakta jsou doplněk: když je zdroj ještě nemá (staré nasazení), stránka funguje dál bez nich
  function nactiFakta(heslo) {
    return fetch(sHeslem(baseFakta, heslo)).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return d && d.radky && d.radky.length ? d : null; }).catch(function () { return null; });
  }
  function nacti(heslo) {
    var url = sHeslem(base, heslo);
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
    Promise.all([nacti(heslo), nactiFakta(heslo)]).then(function (vys) {
      var data = vys[0];
      ulozit(heslo);
      FAKTA = vys[1];
      C = kontext(data);
      document.getElementById('stav').textContent = 'stav k ' + vedDen(C.todayStr) + ' ' + C.hhmm;
      document.getElementById('oknoObsah').innerHTML = info(C);
      document.getElementById('odhlasit').hidden = false;
      var sh = document.getElementById('sheet');   // odkaz na zdrojový Sheet posílá skript jen po ověření hesla
      if (/^https:\/\/docs\.google\.com\//.test(data.zdroj || '')) { sh.href = data.zdroj; sh.hidden = false; }
      vykresli();
    }).catch(function (err) {
      if (err.heslo) { ulozit(''); prihlaseni('Špatné heslo.'); return; }
      document.getElementById('obsah').innerHTML = '<div class="msg chyba">Data se nepodařilo načíst (' + esc(err.message) + ').</div>';
    });
  }
  window.addEventListener('hashchange', function () { if (C) { zHashe(); vykresli(); } });
  document.getElementById('odhlasit').addEventListener('click', function () { ulozit(''); C = null; document.getElementById('sheet').hidden = true; prihlaseni(''); });
  zHashe();
  start(ulozene());
})();
