// Dashboard výkonu obchodníků — data z posledního snímku v Sheetu (JSON { sloupce, radky }), nic se neukládá.
// Výpočty, pořadí a barevné škály jsou stejné jako ve skriptu v Sheetu; vzhled je vlastní (tmavý dashboard).
//   Záložka Skóre: tři tabulky vedle sebe jako list pro_vedeni v Sheetu — celá doba / 3 měsíce / 30 dní,
//   každá seřazená podle svého skóre.
//   Záložka Měsíční data: obrat, zisk, marže, schůzky a nabídky po měsících pod sebou (scroll), celý rok led–pro;
//   pod nimi leady a konverze (kanál A+B vs. OP od Sabiny) — počítané tady z „faktů" (?co=fakta) ze Sheetu.
//   Sheet obnovuje vždy všechna data najednou; když obchody a leady přesto nejsou ze stejného stažení jako
//   snímek (obnova nedoběhla), konverze se nezobrazí — místo zkreslených čísel je výzva k obnově.
// Každé číslo má vysvětlivku (data-tip): najetí myší ji ukáže, klepnutí / kliknutí ji připne.
// Přístup: heslo ověřuje skript v Sheetu (?co=vedeni&h=…, ?co=fakta&h=…); stránka heslo nezná, jen ho pošle.
// Automaticky: každých 10 minut (a při návratu na záložku) zkontroluje novou verzi stránky (version.json → znovu
// načíst) a nová data v Sheetu (→ překreslit na stejném místě), aby nikde nevisela stará verze ani stará čísla.
(function () {
  'use strict';

  // ── konstanty shodné se skriptem v Sheetu ──
  var MONTH_LABELS = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'];
  var MESIC = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
  var V_MESICI = ['v lednu', 'v únoru', 'v březnu', 'v dubnu', 'v květnu', 'v červnu', 'v červenci', 'v srpnu', 'v září', 'v říjnu', 'v listopadu', 'v prosinci'];
  var HEAT_FLOOR_PCT = 0.12, HEAT_GAMMA = 0.75, ALERT_MIN_MONTHS = 2;
  var VYCHOZI_VAHY = { obrat: 50, zisk: 35, schuzky: 15 }, VYCHOZI_HRANICE = 1200000;
  var OBNOV = '📊 Dashboard → 🔄 Obnovit data pro dashboard';

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
  function ymKey(k) { return Math.floor((k - 1) / 12) + '-' + ('0' + ((k - 1) % 12 + 1)).slice(-2); }
  function mesRok(k) { return MESIC[(k - 1) % 12] + ' ' + Math.floor((k - 1) / 12); }
  function vMes(k) { return V_MESICI[(k - 1) % 12]; }
  function vedMil(v) { return v >= 1000000 ? (v / 1000000).toFixed(2).replace('.', ',') + ' M' : Math.round(v / 1000) + ' K'; }
  function vedDen(iso) { return parseInt(iso.substring(8, 10), 10) + '. ' + parseInt(iso.substring(5, 7), 10) + '. ' + iso.substring(0, 4); }
  function dmy(iso) { return parseInt(iso.substring(8, 10), 10) + '. ' + parseInt(iso.substring(5, 7), 10) + '.'; }
  function tis(v) { return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function kc(v) { return tis(v) + ' Kč'; }
  function des1(v) { return (Math.round(v * 10) / 10).toFixed(1).replace('.', ','); }
  function proc(v) { return Math.round(v * 100) + ' %'; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
  // vysvětlivka: první řádek = nadpis, další = výpočet
  function tip() { return ' data-tip="' + esc(Array.prototype.slice.call(arguments).filter(function (x) { return x !== null && x !== ''; }).join('\n')) + '"'; }

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
      rowsOZ: [], jmeno: {}, ratC: {}, ratQ: {}, ratM: {}, win: {}, obYM: {}, ziYM: {}, scYM: {}, nabYM: {}, start: {},
      W: { obrat: vahy[0] || VYCHOZI_VAHY.obrat, zisk: vahy[1] || VYCHOZI_VAHY.zisk, schuzky: vahy[2] || VYCHOZI_VAHY.schuzky },
      hranice: num(dnes[0], 'hranice_slaby_mesic') || VYCHOZI_HRANICE,
      year: year, curMonthIdx: +den.substring(5, 7) - 1, todayStr: den, hhmm: txt(dnes[0], 'cas'), from30Str: ds(f30)
    };
    dnes.forEach(function (r) {
      var d = txt(r, 'oz');
      c.rowsOZ.push([d, txt(r, 'jmeno'), num(r, 'raynet_id')]);
      c.jmeno[d] = txt(r, 'jmeno') || d;
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
  function poradiOZ(c) { return c.rowsOZ.slice().sort(function (a, b) { return (c.ratC[b[0]] - c.ratC[a[0]]) || (c.ratQ[b[0]] - c.ratQ[a[0]]); }); }

  // ─────────────────────────── SKÓRE (jako list pro_vedeni v Sheetu) ───────────────────────────
  function renderSkore(c) {
    var OB = [
      { k: 'c', r: 'ratC', nazev: 'Celá doba', pod: 'od nástupu · Ø za měsíc', h: 'Ø/měs', od: true, cls: 'p1',
        popis: 'od nástupu každého obchodníka. Hodnoty jsou průměr za měsíc (součet ÷ počet dní × 30), aby šli srovnat lidé s různě dlouhou dobou v týmu.' },
      { k: 'q', r: 'ratQ', nazev: '3 měsíce', pod: 'posledních 90 dní · Ø za měsíc', h: 'Ø/měs', cls: 'p2',
        popis: 'posledních 90 dní (u nováčků od nástupu). Hodnoty jsou průměr za měsíc (součet ÷ počet dní × 30).' },
      { k: 'm', r: 'ratM', nazev: '30 dní', pod: dmy(c.from30Str) + ' – ' + dmy(c.todayStr) + ' · součet', h: '30 dní', cls: 'p3',
        popis: dmy(c.from30Str) + ' – ' + dmy(c.todayStr) + ' (posledních 30 dní). Hodnoty jsou prostý součet.' }
    ];
    var SL = [{ key: 'o', nazev: 'Obrat', w: c.W.obrat, fmt: vedMil, presne: kc,
                def: 'součet celkových částek vyhraných OP (bez DPH) podle data výhry; OP bez vyplněné částky se nepočítá' },
              { key: 'z', nazev: 'Zisk', w: c.W.zisk, fmt: vedMil, presne: kc, def: 'součet obchodního zisku vyhraných OP podle data výhry' },
              { key: 's', nazev: 'Schůzky', w: c.W.schuzky, fmt: function (v) { return String(Math.round(v)); }, presne: function (v) { return des1(v); },
                def: 'realizované schůzky (stav Realizovaná), kde je obchodník vlastníkem, podle data schůzky' }];
    var h = ['<p class="napoveda">Každé období je seřazené podle svého skóre. Najeď myší na číslo (na telefonu klepni) — ukáže se, jak se počítá.</p><div class="skore3">'];
    OB.forEach(function (p) {
      var R = c[p.r];
      var mes = function (d, key) { var x = c.win[d][p.k]; return x[key] / x.dni * 30; };
      var hi = {}, best = {};
      SL.forEach(function (s) {
        hi[s.key] = 0;
        c.rowsOZ.forEach(function (r) { var v = mes(r[0], s.key); if (v > hi[s.key]) { hi[s.key] = v; best[s.key] = r[0]; } });
      });
      var poradi = c.rowsOZ.slice().sort(function (a, b) { return (R[b[0]] - R[a[0]]) || (c.ratC[b[0]] - c.ratC[a[0]]); });
      var n = p.od ? 6 : 5;
      var t = ['<div class="tw"><table class="g skt"><thead>' +
        '<tr class="grp"><th class="' + p.cls + '" colspan="' + n + '"' + tip(p.nazev, p.nazev + ' = ' + p.popis) + '>' + esc(p.nazev) + ' <span class="w">· ' + esc(p.pod) + '</span></th></tr>' +
        '<tr><th class="l st">Obchodník</th>' + (p.od ? '<th class="c"' + tip('od', 'Měsíc nástupu do týmu — od něj se počítá celá doba.') + '>od</th>' : '') +
        '<th class="c"' + tip('Skóre 0–100', 'Vážený součet: obrat ' + c.W.obrat + ' % + zisk ' + c.W.zisk + ' % + schůzky ' + c.W.schuzky + ' %.',
                             'Každá složka se porovná s nejlepším v týmu v tomto období (nejlepší = plné body).') + '>Skóre</th>' +
        SL.map(function (s) { return '<th' + tip(s.nazev + ' ' + p.h, s.nazev + ' = ' + s.def + '.', p.k === 'm' ? 'Za 30 dní: prostý součet.' : 'Ø/měs = součet za období ÷ počet dní × 30.',
                                                 'Barva: srovnání s nejlepším v týmu (zelená = nejlepší).') + '>' + s.nazev + '</th>'; }).join('') +
        '</tr></thead><tbody>'];
      poradi.forEach(function (r) {
        var d = r[0], st = c.start[d], x = c.win[d][p.k], body = 0, rozpad = [];
        SL.forEach(function (s) {
          var v = mes(d, s.key), podil = hi[s.key] > 0 ? v / hi[s.key] : 0, b = podil * s.w;
          body += b;
          rozpad.push(s.nazev + ' ' + s.fmt(v) + ' = ' + Math.round(podil * 100) + ' % nejlepšího (' + best[s.key] + ') × ' + s.w + ' = ' + des1(b) + ' b.');
        });
        var row = '<td class="l st oz">' + esc(d) + '</td>';
        if (p.od) row += '<td class="c od"' + tip(c.jmeno[d], 'V týmu od: ' + MESIC[parseInt(st.substring(5, 7), 10) - 1] + ' ' + st.substring(0, 4) + '.') + '>' +
                         MONTH_LABELS[parseInt(st.substring(5, 7), 10) - 1] + ' ' + st.substring(2, 4) + '</td>';
        row += '<td class="c h sk" style="' + bg(heatColorRich(R[d] / 100)) + '"' +
               tip('Skóre ' + R[d] + ' · ' + d + ' · ' + p.nazev.toLowerCase(), rozpad.join('\n'), 'Součet ' + des1(body) + ' → ' + R[d]) + '>' + R[d] + '</td>';
        SL.forEach(function (s) {
          var v = mes(d, s.key), barva = s.key === 's' ? heatColor(hi.s > 0 ? v / hi.s : 0) : heat3Rel(v, hi[s.key]);
          var vypocet = p.k === 'm'
            ? s.nazev + ' za 30 dní = ' + s.presne(x[s.key]) + ' (' + s.def + ').'
            : s.nazev + ' za ' + x.dni + ' dní = ' + s.presne(x[s.key]) + ' → ÷ ' + x.dni + ' × 30 = ' + s.presne(v) + ' za měsíc.';
          row += '<td class="h" style="' + bg(barva) + '"' + tip(s.nazev + ' · ' + d + ' · ' + p.nazev.toLowerCase(), vypocet,
            'Nejlepší: ' + best[s.key] + ' ' + s.fmt(hi[s.key]) + ' → ' + Math.round(hi[s.key] > 0 ? v / hi[s.key] * 100 : 0) + ' % nejlepšího.') + '>' + esc(s.fmt(v)) + '</td>';
        });
        t.push('<tr>' + row + '</tr>');
      });
      t.push('</tbody></table></div>');
      h.push(t.join(''));
    });
    h.push('</div>');
    return h.join('');
  }

  // ─────────────────────────── MĚSÍČNÍ DATA ───────────────────────────
  var METRIKY = [
    { id: 'obrat', nazev: 'Obrat', jednotka: 'Kč bez DPH', ym: 'obYM', fmt: function (v) { return v ? vedMil(v) : '0'; }, presne: kc, scale: 'rel', alarm: true, obec: 'součet celkových částek vyhraných OP (bez DPH) podle data výhry; OP bez vyplněné částky se nepočítá',
      def: function (k) { return 'součet celkových částek vyhraných OP (bez DPH) s datem výhry ' + vMes(k) + '; OP bez vyplněné částky se nepočítá'; } },
    { id: 'zisk', nazev: 'Zisk', jednotka: 'Kč bez DPH', ym: 'ziYM', fmt: function (v) { return v ? vedMil(v) : '0'; }, presne: kc, scale: 'rel', obec: 'součet obchodního zisku vyhraných OP podle data výhry',
      def: function (k) { return 'součet obchodního zisku vyhraných OP s datem výhry ' + vMes(k); } },
    { id: 'marze', nazev: 'Marže', jednotka: '% (zisk ÷ obrat)', pct: true, fmt: function (v) { return Math.round(v) + ' %'; } },
    { id: 'schuzky', nazev: 'Schůzky', jednotka: 'realizované', ym: 'scYM', fmt: function (v) { return String(Math.round(v)); }, presne: tis, scale: 'count', obec: 'realizované schůzky (stav Realizovaná), kde je obchodník vlastníkem, podle data schůzky',
      def: function (k) { return 'realizované schůzky (stav Realizovaná), kde je obchodník vlastníkem, s datem schůzky ' + vMes(k); } },
    { id: 'nabidky', nazev: 'Nabídky', jednotka: 'vytvořené', ym: 'nabYM', fmt: function (v) { return String(Math.round(v)); }, presne: tis, scale: 'count', obec: 'nabídky obchodníka podle data platnosti od',
      def: function (k) { return 'nabídky obchodníka s datem platnosti od ' + vMes(k); } }
  ];

  function renderMesice(c) {
    return '<p class="napoveda">Najeď myší na číslo (na telefonu klepni) — ukáže se, jak se počítá. Šedý sloupec = probíhající měsíc, zatím se nehodnotí.</p>' +
      '<div class="skupina prvni">Výkon · snímek ' + vedDen(c.todayStr) + ' ' + esc(c.hhmm) + '</div>' +
      METRIKY.map(function (mt) { return mesicniTabulka(c, mt); }).join('') + renderLeady(c, FAKTA);
  }
  function rokMesice(c) { var m = []; for (var i = 1; i <= 12; i++) m.push(c.year * 12 + i); return m; }
  function hlavickaMesicu(months, curYm) {
    return months.map(function (kk) {
      var mi = (kk - 1) % 12, yy = String(Math.floor((kk - 1) / 12)).substring(2);
      var cls = kk === curYm ? 'mes akt' : kk > curYm ? 'mes bud' : 'mes';
      return '<th class="' + cls + '"' + (kk === curYm ? tip('Probíhající měsíc', 'Zatím neúplný (výhry se zapisují hlavně na konci měsíce), proto se nehodnotí barvou.') : '') + '>' +
             MONTH_LABELS[mi] + ' ' + yy + (kk === curYm ? '<small>probíhá</small>' : '') + '</th>';
    }).join('');
  }
  function sekce(id, nazev, popis, tipNadpis) {
    return '<div class="sekce-m" id="' + id + '"><h2' + (tipNadpis ? tip.apply(null, [nazev].concat(tipNadpis)) : '') + '>' + esc(nazev) + '</h2><span>' + esc(popis) + '</span></div>';
  }

  function mesicniTabulka(c, mt) {
    var curYm = c.year * 12 + c.curMonthIdx + 1;
    var startIdx = {};
    c.rowsOZ.forEach(function (r) { startIdx[r[0]] = ymToIdx(c.start[r[0]]); });
    var months = rokMesice(c);   // vždy celý rok led–pro; budoucí měsíce prázdné
    var ord = poradiOZ(c);
    var ym = mt.pct ? null : c[mt.ym];
    var val = mt.pct ? function (d, key) { var o = c.obYM[d][key] || 0; return o > 0 ? (c.ziYM[d][key] || 0) / o * 100 : null; }
                     : function (d, key) { return ym[d][key] || 0; };
    var hi = 0, lo = null;
    ord.forEach(function (r) { months.forEach(function (kk) {
      if (kk < startIdx[r[0]] || kk >= curYm) return;
      var v = val(r[0], ymKey(kk)); if (v === null) return;
      hi = Math.max(hi, v); lo = lo === null ? v : Math.min(lo, v);
    }); });
    function barva(v) {
      if (mt.pct) return heatColor(hi > lo ? (v - lo) / (hi - lo) : 1);
      return mt.scale === 'rel' ? heat3Rel(v, hi) : heatColor(hi > 0 ? v / hi : 0);
    }
    var defNadpis = mt.pct ? ['Marže = zisk ÷ obrat vyhraných OP v daném měsíci (podle data výhry).', 'Celkem = součet zisku ÷ součet obratu, ne průměr procent.']
                           : [mt.nazev + ' = ' + mt.obec + '.', 'Celkem = součet za rok (vč. probíhajícího měsíce). Tým = součet obchodníků v tabulce.'];
    defNadpis.push('Barva: srovnání v rámci tabulky (zelená = vyšší, červená = nižší).' + (mt.alarm ? ' Sytě červená = 2 a více uzavřených měsíců po sobě pod ' + vedMil(c.hranice) + '.' : ''));
    var h = [sekce('m-' + mt.id, mt.nazev, 'po měsících · ' + mt.jednotka, defNadpis)];
    h.push('<div class="tw"><table class="g mx"><thead><tr><th class="l st">Obchodník</th>' + hlavickaMesicu(months, curYm) + '<th class="sep">Celkem</th></tr></thead><tbody>');
    var tymO = months.map(function () { return 0; }), tymZ = months.map(function () { return 0; }), tym = months.map(function () { return 0; });
    function popisBunky(d, kk, v, o, z) {
      var nad = mt.nazev + ' · ' + d + ' · ' + mesRok(kk);
      if (mt.pct) return [nad, 'Zisk ' + kc(z) + ' ÷ obrat ' + kc(o) + ' = ' + des1(z / o * 100) + ' %'];
      var def = mt.def(kk);
      return [nad, mt.presne(v) + ' = ' + def.charAt(0) + def.substring(1) + '.'];
    }
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
        if (kk < startIdx[d]) { row += '<td class="dim"' + tip(d, 'V týmu až od: ' + MESIC[(startIdx[d] - 1) % 12] + ' ' + Math.floor((startIdx[d] - 1) / 12) + '.') + '></td>'; return; }
        var key = ymKey(kk), v = val(d, key), akt = kk === curYm;
        var o = c.obYM[d][key] || 0, z = c.ziYM[d][key] || 0;
        if (mt.pct) {
          rO += o; rZ += z; tymO[i] += o; tymZ[i] += z;
          if (v === null) { row += '<td class="dim"' + tip(mt.nazev + ' · ' + d + ' · ' + mesRok(kk), 'Žádný obrat — marže se nedá spočítat.') + '></td>'; return; }
        } else { s += v; tym[i] += v; }
        var t = popisBunky(d, kk, v, o, z);
        if (alarm[kk]) row += '<td class="alarm"' + tip.apply(null, t.concat(['⚠ Alarm: 2 a více uzavřených měsíců po sobě pod ' + vedMil(c.hranice) + '.'])) + '>' + esc(mt.fmt(v)) + '</td>';
        else if (akt) row += '<td class="akt"' + tip.apply(null, t.concat(['Probíhající měsíc — zatím neúplný, nehodnotí se barvou.'])) + '>' + esc(mt.fmt(v)) + '</td>';
        else row += '<td class="h" style="' + bg(barva(v)) + '"' + tip.apply(null, t) + '>' + esc(mt.fmt(v)) + '</td>';
      });
      var od = MONTH_LABELS[(Math.max(startIdx[d], c.year * 12 + 1) - 1) % 12];
      var celT = mt.pct ? (rO > 0 ? tip(mt.nazev + ' · ' + d + ' · ' + c.year, 'Zisk ' + kc(rZ) + ' ÷ obrat ' + kc(rO) + ' = ' + des1(rZ / rO * 100) + ' %') : '')
                        : tip(mt.nazev + ' · ' + d + ' · ' + c.year, 'Součet ' + od + '–' + MONTH_LABELS[c.curMonthIdx] + ' = ' + mt.presne(s) + '.');
      row += '<td class="cel sep"' + celT + '>' + esc(mt.pct ? (rO > 0 ? mt.fmt(rZ / rO * 100) : '') : mt.fmt(s)) + '</td></tr>';
      h.push(row);
    });
    var tot = sum(tym), so = sum(tymO), sz = sum(tymZ);
    h.push('<tr class="tym"><td class="l st"' + tip('Tým', 'Součet obchodníků v tabulce (vedoucí obchodu se nepočítá).') + '>Tým</td>' + months.map(function (kk, i) {
      if (kk > curYm) return '<td class="bud"></td>';
      var t = mt.pct ? (tymO[i] > 0 ? tip('Marže · tým · ' + mesRok(kk), 'Zisk ' + kc(tymZ[i]) + ' ÷ obrat ' + kc(tymO[i]) + ' = ' + des1(tymZ[i] / tymO[i] * 100) + ' %') : '')
                     : tip(mt.nazev + ' · tým · ' + mesRok(kk), 'Součet obchodníků = ' + mt.presne(tym[i]) + '.');
      return '<td' + t + '>' + esc(mt.pct ? (tymO[i] > 0 ? mt.fmt(tymZ[i] / tymO[i] * 100) : '') : mt.fmt(tym[i])) + '</td>';
    }).join('') + '<td class="sep"' + (mt.pct ? (so > 0 ? tip('Marže · tým · ' + c.year, 'Zisk ' + kc(sz) + ' ÷ obrat ' + kc(so) + ' = ' + des1(sz / so * 100) + ' %') : '')
                                                 : tip(mt.nazev + ' · tým · ' + c.year, 'Součet = ' + mt.presne(tot) + '.')) + '>' +
      esc(mt.pct ? (so > 0 ? mt.fmt(sz / so * 100) : '') : mt.fmt(tot)) + '</td></tr></tbody></table></div>');
    return h.join('');
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
    var h = ['<div class="skupina" id="m-leady-skupina">Leady a konverze · kanál A+B vs. OP od Sabiny</div>'];
    var obnov = 'V Sheetu klikni <b>' + esc(OBNOV) + '</b> (nebo počkej na noční obnovu).';
    if (!F) return h.join('') + '<div class="nic">Leady a konverze se zobrazí po první obnově dat. ' + obnov + '</div>';
    var st = F.stav || {}, den = function (k) { return String(st[k] || '').substring(0, 10); };
    if (den('obchody') !== c.todayStr || den('leady') !== c.todayStr) {
      return h.join('') + '<div class="nic varovani">⚠ Leady a konverze nejsou ze stejného stažení jako zbytek dashboardu ' +
        '(snímek ' + esc(vedDen(c.todayStr)) + ', obchody ' + esc(kdy(st.obchody)) + ', leady ' + esc(kdy(st.leady)) + '), konverze by byla zkreslená. ' + obnov + '</div>';
    }
    var x = faktaIndex(F), curYm = c.year * 12 + c.curMonthIdx + 1, months = rokMesice(c);
    var ord = poradiOZ(c).map(function (r) { return r[0]; });
    var jeOZ = {}; ord.forEach(function (d) { jeOZ[d] = true; });
    var g = function (met, kdo, k) { return ((x[met] || {})[kdo] || {})[k] || 0; };
    var g2 = function (met, kdos, k) { return kdos.reduce(function (s, kdo) { return s + g(met, kdo, k); }, 0); };
    var ostatni = function (met) { return Object.keys(x[met] || {}).filter(function (kdo) { return !jeOZ[kdo] && kdo !== SABINA; }).sort(); };
    var start = {}; ord.forEach(function (d) { start[d] = ymToIdx(c.start[d]); });
    var pocet = function (v) { return String(Math.round(v)); };

    // Přidělené leady A+B — validní leady (fáze ≠ Zrušený), vlastník = OZ; Tým = všechny validní leady firmy
    var ostL = ostatni('leady_validni'), vsiL = ord.concat([SABINA], ostL);
    var leadyDef = function (kdo, k) { return 'Validní leady (fáze ≠ Zrušený) s vlastníkem ' + kdo + ' a datem leadu ' + vMes(k) + '.'; };
    h.push(tabulka(c, months, curYm, {
      id: 'm-leady', nazev: 'Přidělené leady A+B', popis: 'validní leady (bez zrušených), vlastník = obchodník · zelená = méně leadů',
      tipNadpis: ['Přidělené leady A+B = validní leady (fáze ≠ Zrušený), kde je obchodník vlastníkem; měsíc podle data leadu.',
                  'Tým (celá firma) = všechny validní leady firmy, proto jsou v tabulce i Sabina a Ostatní.',
                  'Barva: zelená = méně leadů (stejný výsledek s menším přídělem leadů je lepší), červená = víc.'],
      typ: 'pocet', obracene: true, fmt: pocet, start: start,
      radky: ord.map(function (d) { return { nazev: d, oz: true, v: function (k) { return g('leady_validni', d, k); }, kdo: d }; })
        .concat([{ nazev: 'Sabina (pre-sales)', v: function (k) { return g('leady_validni', SABINA, k); }, kdo: SABINA }])
        .concat(ostL.length ? [{ nazev: 'Ostatní', title: ostL.join(', '), v: function (k) { return g2('leady_validni', ostL, k); }, kdo: ostL.join(', ') }] : []),
      tym: function (k) { return g2('leady_validni', vsiL, k); }, tymNazev: 'Tým (celá firma)', tymKdo: 'kdokoli (celá firma)',
      popisBunky: function (r, k, v) { return [leadyDef(r.kdo, k), 'Počet: ' + v]; },
      popisCelkem: function (r, v) { return ['Součet za rok: ' + v + ' validních leadů.']; }
    }));
    // Konverze A+B = vyhraná OP mimo S-zaměření (měsíc dle data výhry) ÷ validní leady; Tým = jen obchodníci.
    // Bez vazby lead → OP (v Raynetu často chybí) — celkové počty obchodníka (David, 3. 10.).
    var konvAB = function (kdos) { return function (k) {
      var l = g2('leady_validni', kdos, k); return { n: g2('vyhry', kdos, k) - g2('vyhry_sabina', kdos, k), d: l }; }; };
    h.push(tabulka(c, months, curYm, {
      id: 'm-konvab', nazev: 'Konverze A+B', popis: 'vyhraná OP mimo S-zaměření ÷ validní leady · měsíční % je orientační, spolehlivý je součet',
      tipNadpis: ['Konverze A+B = vyhraná OP obchodníka mimo kategorii S-zaměření (měsíc podle data výhry) ÷ jeho validní leady (měsíc podle data leadu).',
                  'Počítá se z celkových počtů — v Raynetu často chybí vazba lead → OP, proto se nepárují jednotlivé leady.',
                  'Měsíční % je orientační (lead a výhra často padnou do jiných měsíců, může vyjít i přes 100 %). Spolehlivý je sloupec Celkem.',
                  'Barva: žlutá = konverze týmu za rok, zelená = dvojnásobek a víc, červená = blízko nule.'],
      typ: 'podil', fmt: proc, start: start,
      radky: ord.map(function (d) { return { nazev: d, oz: true, p: konvAB([d]) }; }),
      tym: konvAB(ord), tymNazev: 'Tým (obchodníci)',
      popisBunky: function (r, k, v, q) {
        return ['Vyhraná OP mimo S-zaměření s datem výhry ' + vMes(k) + ': ' + q.n,
                'Validní leady s datem leadu ' + vMes(k) + ': ' + q.d, q.d > 0 ? 'Konverze = ' + q.n + ' ÷ ' + q.d + ' = ' + proc(q.n / q.d) : 'Žádné leady — konverze se nedá spočítat.'];
      },
      popisCelkem: function (r, v, q) { return ['Za rok: ' + q.n + ' vyhraných OP mimo S-zaměření ÷ ' + q.d + ' validních leadů' + (q.d > 0 ? ' = ' + proc(q.n / q.d) : '') + '.']; }
    }));
    // Přidělené OP od Sabiny — kategorie S-zaměření, jakýkoli stav, měsíc dle otevření OP
    var ostS = ostatni('op_sabina'), vsiS = ord.concat(ostS);
    h.push(tabulka(c, months, curYm, {
      id: 'm-opsab', nazev: 'Přidělené OP od Sabiny', popis: 'obchodní případy kategorie S-zaměření (jakýkoli stav), měsíc dle otevření · zelená = méně',
      tipNadpis: ['Přidělené OP od Sabiny = obchodní případy kategorie S-zaměření (jakýkoli stav), kde je obchodník vlastníkem; měsíc podle data otevření OP.',
                  'Barva: zelená = méně, červená = víc.'],
      typ: 'pocet', obracene: true, fmt: pocet, start: start,
      radky: ord.map(function (d) { return { nazev: d, oz: true, v: function (k) { return g('op_sabina', d, k); }, kdo: d }; })
        .concat(ostS.length ? [{ nazev: 'Ostatní', title: ostS.join(', '), v: function (k) { return g2('op_sabina', ostS, k); }, kdo: ostS.join(', ') }] : []),
      tym: function (k) { return g2('op_sabina', vsiS, k); }, tymNazev: 'Tým',
      popisBunky: function (r, k, v) { return ['OP kategorie S-zaměření s vlastníkem ' + (r.kdo || 'kdokoli z tabulky') + ' otevřená ' + vMes(k) + ' (jakýkoli stav).', 'Počet: ' + v]; },
      popisCelkem: function (r, v) { return ['Součet za rok: ' + v + ' OP od Sabiny.']; }
    }));
    // Konverze OP od Sabiny = vyhraná ÷ přidělená (obojí dle měsíce otevření OP)
    var konvS = function (kdos) { return function (k) { return { n: g2('op_sabina_vyhra', kdos, k), d: g2('op_sabina', kdos, k) }; }; };
    h.push(tabulka(c, months, curYm, {
      id: 'm-konvsab', nazev: 'Konverze OP od Sabiny', popis: 'vyhraná ÷ přidělená OP od Sabiny, měsíc dle otevření OP',
      tipNadpis: ['Konverze OP od Sabiny = z OP kategorie S-zaměření otevřených v měsíci kolik je vyhraných.',
                  'U posledních měsíců číslo ještě poroste — část OP se teprve rozhoduje.',
                  'Barva: žlutá = konverze týmu za rok, zelená = dvojnásobek a víc.'],
      typ: 'podil', fmt: proc, start: start,
      radky: ord.map(function (d) { return { nazev: d, oz: true, p: konvS([d]) }; })
        .concat(ostS.length ? [{ nazev: 'Ostatní', title: ostS.join(', '), p: konvS(ostS) }] : []),
      tym: konvS(vsiS), tymNazev: 'Tým',
      popisBunky: function (r, k, v, q) {
        return ['OP od Sabiny otevřená ' + vMes(k) + ': ' + q.d, 'Z nich vyhraná: ' + q.n, q.d > 0 ? 'Konverze = ' + q.n + ' ÷ ' + q.d + ' = ' + proc(q.n / q.d) : 'Žádná OP od Sabiny.'];
      },
      popisCelkem: function (r, v, q) { return ['Za rok: ' + q.n + ' vyhraných ÷ ' + q.d + ' přidělených' + (q.d > 0 ? ' = ' + proc(q.n / q.d) : '') + '.']; }
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
    function souhrn(r) {
      var ks = months.filter(function (k) { return k <= curYm; });
      if (t.typ === 'pocet') { var s = ks.reduce(function (a, k) { return a + r.v(k); }, 0); return { txt: t.fmt(s), v: s }; }
      var n = 0, d = 0; ks.forEach(function (k) { var q = r.p(k); n += q.n; d += q.d; });
      return { txt: d > 0 ? t.fmt(n / d) : '–', v: d > 0 ? n / d : null, q: { n: n, d: d } };
    }
    var h = [sekce(t.id, t.nazev, t.popis, t.tipNadpis)];
    h.push('<div class="tw"><table class="g mx"><thead><tr><th class="l st">Obchodník</th>' + hlavickaMesicu(months, curYm) + '<th class="sep">Celkem</th></tr></thead><tbody>');
    var T = t.typ === 'pocet' ? { v: t.tym, kdo: t.tymKdo } : { p: t.tym };
    var radek = function (r, nazev, cls) {
      var row = '<tr' + cls + '><td class="l st oz"' + (r.title ? tip(nazev, r.title) : '') + '>' + esc(nazev) + '</td>';
      months.forEach(function (k) {
        if (k > curYm) { row += '<td class="bud"></td>'; return; }
        var v = hodnota(r, k), txt = v === null ? '–' : t.fmt(v), q = t.typ === 'podil' ? r.p(k) : null;
        var tp = [t.nazev + ' · ' + nazev + ' · ' + mesRok(k)].concat(t.popisBunky(r, k, t.typ === 'pocet' ? v : null, q));
        if (k === curYm) row += '<td class="akt"' + tip.apply(null, tp.concat(['Probíhající měsíc — zatím neúplný.'])) + '>' + esc(txt) + '</td>';
        else if (!r.oz || v === null || k < t.start[r.nazev] || hi === null) row += '<td' + tip.apply(null, tp) + '>' + esc(txt) + '</td>';
        else row += '<td class="h" style="' + bg(barva(v)) + '"' + tip.apply(null, tp) + '>' + esc(txt) + '</td>';
      });
      var s = souhrn(r);
      return row + '<td class="cel sep"' + tip.apply(null, [t.nazev + ' · ' + nazev + ' · ' + c.year].concat(t.popisCelkem(r, s.v, s.q))) + '>' + esc(s.txt) + '</td></tr>';
    };
    t.radky.forEach(function (r) { h.push(radek(r, r.nazev, r.oz ? '' : ' class="ost"')); });
    h.push(radek(T, t.tymNazev, ' class="tym"').replace('<td class="l st oz"', '<td class="l st"') + '</tbody></table></div>');
    return h.join('');
  }

  // ─────────────────────────── OKNO ⓘ ───────────────────────────
  function info(c) {
    return '<h2>Jak se počítá</h2>' +
      '<p class="tip-hint">U každého čísla na stránce: najeď na něj myší (na telefonu klepni) a uvidíš přesný výpočet.</p>' +
      '<h3>Skóre</h3><div class="vahy"><div><b>' + c.W.obrat + ' %</b>obrat</div><div><b>' + c.W.zisk +
      ' %</b>zisk</div><div><b>' + c.W.schuzky + ' %</b>schůzky</div></div>' +
      '<p>Skóre 0–100 = vážený součet obratu, zisku a schůzek. Každá složka se porovná s nejlepším v týmu v daném období (nejlepší = plné body). ' +
      'Tři tabulky = tři období, každá seřazená podle svého skóre.</p>' +
      '<p><b>Celá doba</b> = od nástupu, <b>3 měsíce</b> = posledních 90 dní: průměr za měsíc (součet ÷ počet dní × 30), aby šli srovnat lidé s různě dlouhou dobou. <b>30 dní</b> = prostý součet.</p>' +
      '<h3>Měsíční data</h3>' +
      '<p>Obrat a zisk = vyhrané OP podle data výhry (OP bez částky se nepočítá). Barva = srovnání v rámci tabulky (zelená vyšší, červená nižší). ' +
      'Sytě červený obrat = 2 a více uzavřených měsíců po sobě pod ' + vedMil(c.hranice) + '. Šedý sloupec „probíhá“ = aktuální měsíc, zatím se nehodnotí.</p>' +
      '<h3>Leady a konverze</h3>' +
      '<p>Konverze A+B = vyhraná OP mimo kategorii S-zaměření (měsíc dle data výhry) ÷ validní leady obchodníka — celkové počty, bez ohledu na to, jestli je OP v Raynetu navázané na lead. ' +
      'U přidělených leadů a OP od Sabiny je zelená ten, kdo jich má méně. U konverzí je žlutá = týmová konverze za rok, zelená = dvojnásobek a víc. Celkem u konverzí = ze součtů, ne průměr procent.</p>' +
      '<h3>Data</h3>' +
      '<p>Sheet obnovuje všechna data najednou — každou noc mezi 5. a 6. hodinou, nebo tlačítkem ' + esc(OBNOV) + '. ' +
      'Kdyby obnova nedoběhla a leady s obchody nebyly ze stejného stažení, konverze se nezobrazí.</p>' +
      '<p style="color:var(--muted)">Data: snímek ' + vedDen(c.todayStr) + ' ' + esc(c.hhmm) + '.</p>';
  }

  // ─────────────────────────── VYSVĚTLIVKY (hover / klepnutí) ───────────────────────────
  var tipEl = document.getElementById('tip'), tipCil = null, pripnuto = false;
  function ukazTip(el) {
    var radky = el.getAttribute('data-tip').split('\n');
    tipEl.innerHTML = '<b>' + esc(radky[0]) + '</b>' + radky.slice(1).map(function (r) { return '<div>' + esc(r) + '</div>'; }).join('');
    tipEl.hidden = false;
    tipCil = el;
    var r = el.getBoundingClientRect(), w = tipEl.offsetWidth, hgt = tipEl.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    var x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), vw - w - 8);
    var y = r.bottom + 8 + hgt > vh - 8 ? r.top - hgt - 8 : r.bottom + 8;
    tipEl.style.left = x + 'px'; tipEl.style.top = Math.max(8, y) + 'px';
  }
  function skryjTip() { tipEl.hidden = true; tipCil = null; pripnuto = false; tipEl.classList.remove('pripnuto'); }
  document.addEventListener('mouseover', function (e) {
    if (pripnuto) return;
    var el = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (el) { if (el !== tipCil) ukazTip(el); } else if (tipCil) skryjTip();
  });
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-tip]');
    if (el) {
      if (pripnuto && tipCil === el) { skryjTip(); return; }
      ukazTip(el); pripnuto = true; tipEl.classList.add('pripnuto'); return;
    }
    if (!e.target.closest('#tip')) skryjTip();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') skryjTip(); });
  window.addEventListener('scroll', function () { if (tipCil) skryjTip(); }, true);
  window.addEventListener('resize', function () { if (tipCil) skryjTip(); });

  // ─────────────────────────── ŘÍZENÍ ───────────────────────────
  var C = null, FAKTA = null, stav = { tab: 'skore' };
  function zHashe() { stav.tab = location.hash.indexOf('mesice') >= 0 ? 'mesice' : 'skore'; }
  function doHashe() { history.replaceState(null, '', '#' + stav.tab); }
  function vykresli() {
    skryjTip();
    document.querySelectorAll('[data-tab]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-tab') === stav.tab)); });
    document.getElementById('obsah').innerHTML = stav.tab === 'mesice' ? renderMesice(C) : renderSkore(C);
    // rychlá navigace po tabulkách měsíčních dat (v liště nahoře)
    var nav = document.getElementById('subnav');
    if (stav.tab === 'mesice') {
      nav.innerHTML = Array.prototype.map.call(document.querySelectorAll('.sekce-m[id], .skupina[id]'), function (s) {
        var h2 = s.querySelector('h2');
        return '<button type="button" data-skok="' + s.id + '">' + esc(h2 ? h2.textContent : 'Leady a konverze') + '</button>';
      }).filter(function (b, i, a) { return !(b.indexOf('m-leady-skupina') >= 0 && a.length > 6); }).join('');
      nav.hidden = false;
    } else nav.hidden = true;
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
    else if (b.dataset.skok) {
      var cil = document.getElementById(b.dataset.skok), hl = document.querySelector('.top').offsetHeight;
      if (cil) window.scrollTo({ top: cil.getBoundingClientRect().top + window.pageYOffset - hl - 10, behavior: 'smooth' });
    }
  });
  var okno = document.getElementById('okno');
  document.getElementById('zavrit').addEventListener('click', function () { okno.close(); });
  okno.addEventListener('click', function (e) { if (e.target === okno) okno.close(); });
  document.getElementById('info').addEventListener('click', function () { if (C) okno.showModal(); });

  // čerstvost dat: snímek starší než 26 h = noční obnova asi neproběhla
  function stavText(c) {
    var t = new Date(+c.todayStr.substring(0, 4), +c.todayStr.substring(5, 7) - 1, +c.todayStr.substring(8, 10),
                     +(c.hhmm.substring(0, 2) || 0), +(c.hhmm.substring(3, 5) || 0));
    var stare = Date.now() - t.getTime() > 26 * 3600 * 1000;
    return 'data k ' + esc(vedDen(c.todayStr) + ' ' + c.hhmm) +
      (stare ? ' <span class="stare"' + tip('Data jsou starší než 1 den', 'Noční obnova asi neproběhla. V Sheetu klikni ' + OBNOV + '.') + '>⚠ starší než 1 den</span>' : '');
  }

  // ── přihlášení: heslo se pošle skriptu v Sheetu; když sedí, vrátí data. Zapamatuje se jen v tomto prohlížeči. ──
  var HESLO_KEY = 'dashboard_heslo';
  function ulozene() { try { return localStorage.getItem(HESLO_KEY) || ''; } catch (e) { return ''; } }
  function ulozit(h) { try { if (h) localStorage.setItem(HESLO_KEY, h); else localStorage.removeItem(HESLO_KEY); } catch (e) {} }
  var Q = new URLSearchParams(location.search);
  var base = Q.get('api') || (window.DASH_CONFIG.API_URL + '?co=vedeni');
  var baseFakta = Q.get('fakta') || (window.DASH_CONFIG.API_URL + '?co=fakta');
  function sHeslem(u, heslo) { return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'h=' + encodeURIComponent(heslo); }
  // fakta jsou doplněk: když je zdroj ještě nemá, stránka funguje dál bez nich
  function nactiFakta(heslo) {
    return fetch(sHeslem(baseFakta, heslo)).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return d && d.radky && d.radky.length ? d : null; }).catch(function () { return null; });
  }
  function nacti(heslo) {
    return fetch(sHeslem(base, heslo)).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (t) {
        var data; try { data = JSON.parse(t); } catch (e) { throw new Error('zdroj neodpověděl daty — je potřeba aktualizovat nasazení skriptu'); }
        if (data.chyba === 'heslo') { var err = new Error('Špatné heslo.'); err.heslo = true; throw err; }
        return data;
      });
  }
  function prihlaseni(zprava) {
    document.getElementById('stav').textContent = '';
    document.getElementById('stav').removeAttribute('data-tip');
    document.getElementById('odhlasit').hidden = true;
    document.getElementById('subnav').hidden = true;
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
  function pouzijData(vys) {
    var data = vys[0];
    podpis = JSON.stringify(vys);
    FAKTA = vys[1];
    C = kontext(data);
    document.getElementById('stav').innerHTML = stavText(C);
    document.getElementById('oknoObsah').innerHTML = info(C);
    document.getElementById('odhlasit').hidden = false;
    var sh = document.getElementById('sheet');   // odkaz na zdrojový Sheet posílá skript jen po ověření hesla
    if (/^https:\/\/docs\.google\.com\//.test(data.zdroj || '')) { sh.href = data.zdroj; sh.hidden = false; }
    oznacKontrolu();
    vykresli();
  }
  function start(heslo) {
    if (!heslo) { prihlaseni(''); return; }
    document.getElementById('obsah').innerHTML = '<div class="msg">Načítám data…</div>';
    Promise.all([nacti(heslo), nactiFakta(heslo)]).then(function (vys) {
      ulozit(heslo);
      HESLO = heslo;
      pouzijData(vys);
    }).catch(function (err) {
      if (err.heslo) { ulozit(''); prihlaseni('Špatné heslo.'); return; }
      document.getElementById('obsah').innerHTML = '<div class="msg chyba">Data se nepodařilo načíst (' + esc(err.message) + ').</div>';
    });
  }

  // ── automatická obnova: nová verze stránky + čerstvá data ──
  var VERZE = window.DASH_VERZE || '', HESLO = '', podpis = '', posledniKontrola = Date.now(), KONTROLA_MS = 10 * 60 * 1000;
  function hhmm(d) { return d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2); }
  function oznacKontrolu() {
    posledniKontrola = Date.now();
    document.getElementById('stav').setAttribute('data-tip', 'Čerstvost dat\nStránka sama kontroluje nová data a novou verzi každých 10 minut a při návratu na záložku.\n' +
      'Poslední kontrola: ' + hhmm(new Date()) + '.');
  }
  function obnovData() {
    Promise.all([nacti(HESLO), nactiFakta(HESLO)]).then(function (vys) {
      if (JSON.stringify(vys) === podpis) { oznacKontrolu(); return; }   // nic nového → nepřekreslovat
      var y = window.pageYOffset;
      pouzijData(vys);
      window.scrollTo(0, y);
    }).catch(function (err) {
      if (err.heslo) { ulozit(''); HESLO = ''; C = null; prihlaseni('Heslo se změnilo — přihlas se znovu.'); }
    });
  }
  function kontrola() {
    posledniKontrola = Date.now();
    fetch('version.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.verze && String(j.verze) !== VERZE) { location.reload(); return; }   // na webu je novější verze
        if (C && HESLO) obnovData();
      }, function () { if (C && HESLO) obnovData(); });
  }
  setInterval(function () { if (document.visibilityState === 'visible') kontrola(); }, KONTROLA_MS);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - posledniKontrola > 2 * 60 * 1000) kontrola();
  });
  window.addEventListener('hashchange', function () { if (C) { zHashe(); vykresli(); } });
  document.getElementById('odhlasit').addEventListener('click', function () { ulozit(''); HESLO = ''; C = null; document.getElementById('sheet').hidden = true; prihlaseni(''); });
  zHashe();
  start(ulozene());
})();
