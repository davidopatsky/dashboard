// Výpočty dashboardu ze SYROVÝCH dat ze Sheetu. Sheet je jen databáze — všechno se počítá tady.
// Pravidla jsou stejná jako dřív ve skriptu v Sheetu (snímek výkonu a fakta); ověřeno na stejných datech.
//   vstup  D = { nastaveni: { tym: [[oz, jméno v Raynetu, raynet id, od RRRR-MM, role]], parametry: {…} },
//                publikovano: { obchody, aktivity, leady: 'RRRR-MM-DD HH:MM' }, obchody / aktivity / leady: { sloupce, radky } }
//   výstup { c: kontext pro skóre a měsíční tabulky, F: počty po osobě × měsíci + leady po dnech }
(function (root) {
  'use strict';
  var DEN = 86400000;
  function dvoj(n) { return ('0' + n).slice(-2); }
  function ds(d) { return d.getFullYear() + '-' + dvoj(d.getMonth() + 1) + '-' + dvoj(d.getDate()); }
  function ymToIdx(ym) { return parseInt(String(ym).substring(0, 4), 10) * 12 + parseInt(String(ym).substring(5, 7), 10); }
  function d10(x) { return String(x || '').substring(0, 10); }
  function objekty(t) {
    if (!t || !t.radky) return [];
    var h = t.sloupce;
    return t.radky.map(function (r) { var o = {}; h.forEach(function (c, i) { o[c] = r[i]; }); return o; });
  }
  function jeValidni(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

  function spocitej(D) {
    var nas = D.nastaveni || { tym: [], parametry: {} }, par = nas.parametry || {};
    var cislo = function (k, x) { var v = Number(par[k]); return isFinite(v) && par[k] !== '' && par[k] !== undefined ? v : x; };
    var W = { obrat: cislo('vaha_obrat', 50), zisk: cislo('vaha_zisk', 35), schuzky: cislo('vaha_schuzky', 15) };
    var wSum = (W.obrat + W.zisk + W.schuzky) || 1;
    var CAT_SZ = cislo('kategorie_s_zamereni', 156);
    var pub = D.publikovano || {}, k = String(pub.obchody || '');
    // „dnes" = kdy se stáhly obchody (stav dat, ne čas otevření stránky)
    var now = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(k) ? new Date(+k.substring(0, 4), +k.substring(5, 7) - 1, +k.substring(8, 10), +k.substring(11, 13), +k.substring(14, 16)) : new Date();
    var year = now.getFullYear(), today0 = new Date(year, now.getMonth(), now.getDate());
    var todayStr = ds(today0), from30Str = ds(new Date(today0.getTime() - 29 * DEN));

    var tym = (nas.tym || []).map(function (r) { return { oz: String(r[0]), jmeno: String(r[1]), id: Number(r[2]), od: String(r[3] || '') || year + '-01', role: String(r[4] || 'obchodník') }; });
    var oz = tym.filter(function (t) { return t.role === 'obchodník'; });
    var presales = tym.filter(function (t) { return t.role === 'pre-sales'; }).map(function (t) { return t.jmeno; });
    var disp = {}; oz.forEach(function (t) { disp[t.jmeno] = t.oz; });
    // vedoucí (role „vedoucí" v listu nastaveni): jen do obratu — občas něco prodá (David 16. 10.); skóre ani další údaje ne
    var vedouci = tym.filter(function (t) { return t.role === 'vedoucí'; }), vedByName = {};
    vedouci.forEach(function (t) { vedByName[t.jmeno] = t.oz; });

    var c = {
      rowsOZ: oz.map(function (t) { return [t.oz, t.jmeno, t.id]; }), jmeno: {}, ratC: {}, ratQ: {}, ratM: {}, win: {},
      obYM: {}, ziYM: {}, scYM: {}, nabYM: {}, start: {}, W: W,
      hranice: cislo('hranice_slaby_mesic', 1200000), alarmMesicu: cislo('alarm_mesicu_po_sobe', 2),
      year: year, curMonthIdx: now.getMonth(), todayStr: todayStr, hhmm: dvoj(now.getHours()) + ':' + dvoj(now.getMinutes()), from30Str: from30Str,
      stazeno: { obchody: pub.obchody || '', aktivity: pub.aktivity || '', leady: pub.leady || '' },
      vedouci: vedouci.map(function (t) { return [t.oz, t.jmeno, t.od]; }), obYMved: {}
    };
    vedouci.forEach(function (t) { c.obYMved[t.oz] = {}; });

    // ── okna skóre: celá doba (od nástupu) / 90 dní / 30 dní — vše včetně dneška ──
    oz.forEach(function (t) {
      var d = t.oz, stD = new Date(+t.od.substring(0, 4), +t.od.substring(5, 7) - 1, 1);
      var dniC = Math.max(1, Math.round((today0 - stD) / DEN) + 1);
      var okno = function (n) { return { od: ds(new Date(Math.max(stD.getTime(), today0.getTime() - (n - 1) * DEN))), dni: Math.min(n, dniC), o: 0, z: 0, s: 0, n: 0, w: 0 }; };
      c.jmeno[d] = t.jmeno; c.start[d] = t.od;
      c.win[d] = { c: okno(dniC), q: okno(90), m: okno(30) };
      c.obYM[d] = {}; c.ziYM[d] = {}; c.scYM[d] = {}; c.nabYM[d] = {};
    });
    function doOken(d, x, key, v) {
      x = d10(x);
      if (x.length !== 10 || x > todayStr) return;
      ['c', 'q', 'm'].forEach(function (kk) { if (x >= c.win[d][kk].od) c.win[d][kk][key] += v; });
    }
    function doMesice(mapa, d, x, v) { x = String(x || ''); if (x.length >= 7) mapa[d][x.substring(0, 7)] = (mapa[d][x.substring(0, 7)] || 0) + v; }

    // ── počty po osobě × měsíci (konverze, leady) — osoba = jméno obchodníka, jinak celé jméno z Raynetu ──
    var x = {};
    function pricti(met, kdo, datum, v) {
      var m = String(datum || '').substring(0, 7);
      if (!/^\d{4}-\d{2}$/.test(m)) return;
      var o = (x[met] = x[met] || {}), q = (o[kdo] = o[kdo] || {}), i = ymToIdx(m);
      q[i] = (q[i] || 0) + v;
    }

    // obchodní případy: výhry (obrat, zisk) podle data výhry; OP od Sabiny podle data otevření
    objekty(D.obchody).forEach(function (r) {
      var d = disp[r.owner], kdo = d || r.owner, kat = Number(r.category_id), win = r.status === 'E_WIN', cl = d10(r.closure_date);
      if (kat === CAT_SZ) { pricti('op_sabina', kdo, r.valid_from, 1); if (win) pricti('op_sabina_vyhra', kdo, r.valid_from, 1); }
      if (!win) return;
      pricti('vyhry', kdo, cl, 1);
      if (kat === CAT_SZ) pricti('vyhry_sabina', kdo, cl, 1);
      if (!d) {   // vedoucí: jen obrat (výhry s částkou, podle data výhry)
        var vd = vedByName[r.owner], a0 = Number(r.amount) || 0;
        if (vd && a0 > 0) doMesice(c.obYMved, vd, cl, a0);
        return;
      }
      doOken(d, cl, 'w', 1);
      var amt = Number(r.amount) || 0;
      if (amt <= 0) return;   // chybějící částka = datový artefakt, do obratu nejde
      var prof = Number(r.profit) || 0;
      doOken(d, cl, 'o', amt); doOken(d, cl, 'z', prof);
      doMesice(c.obYM, d, cl, amt); doMesice(c.ziYM, d, cl, prof);
    });
    // aktivity: realizované schůzky (vlastník schůzky) a nabídky (vlastník nabídky);
    // nabídky a telefonáty navíc po osobě × měsíci pro kohokoli (sekce Sabina) — telefonáty v jakémkoli stavu
    var TEL = { COMPLETED: 'tel_realizovane', SCHEDULED: 'tel_planovane', CANCELLED: 'tel_zrusene' };
    objekty(D.aktivity).forEach(function (r) {
      var kdo = disp[r.owner] || r.owner;
      if (r.typ === 'nabídka') pricti('nabidky', kdo, r.datum, 1);
      else if (r.typ === 'telefonát') pricti(TEL[r.status] || 'tel_jine', kdo, r.datum, 1);
      var d = disp[r.owner]; if (!d) return;
      if (r.typ === 'schůzka' && r.status === 'COMPLETED') { doOken(d, r.datum, 's', 1); doMesice(c.scYM, d, r.datum, 1); }
      else if (r.typ === 'nabídka') { doOken(d, r.datum, 'n', 1); doMesice(c.nabYM, d, r.datum, 1); }
    });
    // leady: všechny leady firmy (po dnech pro záložku Leady) + validní po osobě × měsíci
    var leadyDny = [];
    objekty(D.leady).forEach(function (r) {
      var vlastnik = r.owner || '(bez vlastníka)', d = disp[r.owner] || '', val = jeValidni(r.valid);
      pricti('leady', d || vlastnik, r.lead_date, 1);
      if (val) pricti('leady_validni', d || vlastnik, r.lead_date, 1);
      leadyDny.push([d10(r.lead_date), String(r.contact_source || '') || '(neuvedeno)', vlastnik, d, val, 1]);
    });

    // ── skóre za 3 okna: sazba za 30 dní → 0–100 vůči nejlepšímu v týmu → váhy ──
    function skore(kk) {
      var rt = {}, mx = [0, 0, 0], out = {};
      oz.forEach(function (t) {
        var w = c.win[t.oz][kk], v = [w.o / w.dni * 30, w.z / w.dni * 30, w.s / w.dni * 30];
        rt[t.oz] = v;
        for (var i = 0; i < 3; i++) if (v[i] > mx[i]) mx[i] = v[i];
      });
      oz.forEach(function (t) {
        var v = rt[t.oz];
        out[t.oz] = Math.round(((mx[0] > 0 ? v[0] / mx[0] * 100 : 0) * W.obrat + (mx[1] > 0 ? v[1] / mx[1] * 100 : 0) * W.zisk +
                                (mx[2] > 0 ? v[2] / mx[2] * 100 : 0) * W.schuzky) / wSum);
      });
      return out;
    }
    c.ratC = skore('c'); c.ratQ = skore('q'); c.ratM = skore('m');

    var F = { x: x, presales: presales[0] || '', stav: c.stazeno, leadyDny: { radky: leadyDny, stazeno: pub.leady || '' } };
    c.souhrn = souhrnMesice(D, tym, year, now.getMonth() + 1, pub.obchody || '');
    c.tymVse = tym;
    return { c: c, F: F };
  }

  // Souhrn měsíc (nebo den) × člověk — záložka Souhrn v appce a listy „souhrn" / „souhrn_den" v Sheetu (pro AI asistenta).
  // Jedna logika pro obojí: Apps Script v Sheetu používá TENTO soubor beze změny (kopie Vypocet.js v projektu skriptu).
  // Pravidla stejná jako výpočty výše: výhry = E_WIN podle closure_date; obrat/zisk = jen výhry s amount > 0;
  // schůzky = realizované (COMPLETED) podle data; nabídky podle data. Vedoucí jen obrat, ostatní prázdné.
  // marze_pct = zisk ÷ obrat × 100 (1 desetinné místo), prázdná při obratu 0.
  function souhrnRadky(D, tym, obdobi, sloupec, stazeno) {   // obdobi = klíče 'RRRR-MM' nebo 'RRRR-MM-DD'
    var byName = {}, chci = {}, out = [], L = obdobi.length ? obdobi[0].length : 7;
    tym.forEach(function (t) { byName[t.jmeno] = t; });
    obdobi.forEach(function (k) { chci[k] = true; });
    var z = {};   // z[jmeno][klíč] = {vyhry, obrat, zisk, schuzky, nabidky}
    var bunka = function (j, d) {
      var k = String(d || '').substring(0, L);
      if (!byName[j] || !chci[k]) return null;
      var o = (z[j] = z[j] || {});
      return (o[k] = o[k] || { vyhry: 0, obrat: 0, zisk: 0, schuzky: 0, nabidky: 0 });
    };
    objekty(D.obchody).forEach(function (r) {
      if (r.status !== 'E_WIN') return;
      var b = bunka(r.owner, d10(r.closure_date)); if (!b) return;
      b.vyhry++;
      var amt = Number(r.amount) || 0;
      if (amt > 0) { b.obrat += amt; b.zisk += Number(r.profit) || 0; }
    });
    objekty(D.aktivity).forEach(function (r) {
      var b;
      if (r.typ === 'schůzka' && r.status === 'COMPLETED') { b = bunka(r.owner, d10(r.datum)); if (b) b.schuzky++; }
      else if (r.typ === 'nabídka') { b = bunka(r.owner, d10(r.datum)); if (b) b.nabidky++; }
    });
    obdobi.forEach(function (k) {
      tym.forEach(function (t) {
        if (k.substring(0, 7) < t.od) return;
        var b = (z[t.jmeno] || {})[k] || { vyhry: 0, obrat: 0, zisk: 0, schuzky: 0, nabidky: 0 }, ved = t.role === 'vedoucí';
        var obrat = Math.round(b.obrat), zisk = Math.round(b.zisk), r = {};
        r[sloupec] = k;
        r.oz = t.oz; r.jmeno = t.jmeno; r.role = t.role; r.vyhry = ved ? null : b.vyhry; r.obrat = obrat;
        r.zisk = ved ? null : zisk; r.marze_pct = ved || !obrat ? null : Math.round(zisk / obrat * 1000) / 10;
        r.schuzky = ved ? null : b.schuzky; r.nabidky = ved ? null : b.nabidky; r.stazeno = stazeno;
        out.push(r);
      });
    });
    return out;
  }
  function souhrnMesice(D, tym, year, curM, stazeno) {
    var mes = [];
    for (var m = 1; m <= curM; m++) mes.push(year + '-' + dvoj(m));
    return souhrnRadky(D, tym, mes, 'mesic', stazeno);
  }
  // po dnech: minulý a aktuální měsíc, každý den až do dneška (i dny s nulou — ať jde srovnat 1.–N. tento vs. minulý měsíc)
  function souhrnDny(D, tym, now, stazeno) {
    var dny = [], d = new Date(now.getFullYear(), now.getMonth() - 1, 1), konec = ds(now);
    while (ds(d) <= konec) { dny.push(ds(d)); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); }
    return souhrnRadky(D, tym, dny, 'datum', stazeno);
  }
  // Pro Apps Script: { mesice: [...], dny: [...] } ze stejných vstupů jako spocitej(D)
  function souhrn(D) {
    var x = spocitej(D), c = x.c;
    var k = String((D.publikovano || {}).obchody || '');
    var now = /^\d{4}-\d{2}-\d{2}/.test(k) ? new Date(+k.substring(0, 4), +k.substring(5, 7) - 1, +k.substring(8, 10)) : new Date();
    return { mesice: c.souhrn, dny: souhrnDny(D, c.tymVse, now, k) };
  }

  root.Vypocet = { spocitej: spocitej, souhrn: souhrn };
})(typeof window !== 'undefined' ? window : this);
