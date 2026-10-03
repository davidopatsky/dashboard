# Dashboard

Jednostránková aplikace (GitHub Pages). V repozitáři je jen kód — žádná data.
Data si stránka stahuje ze zdroje nastaveného v `config.js` (po zadání hesla) a každých 10 minut je kontroluje znovu.

- `index.html` — kostra stránky; načte `app.css`, `config.js` a `app.js` s `?v=<verze>` z `version.json`
- `app.css` — vzhled
- `app.js` — načtení dat, výpočty a vykreslení dashboardu
- `config.js` — adresa zdroje dat
- `version.json` — **verze; při každé změně ji zvýšit.** Otevřené stránky si ji kontrolují a při změně se samy znovu načtou.

Lokální náhled s vlastními daty: `index.html?api=vedeni.json&fakta=fakta.json`
