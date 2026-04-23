# OpsScreen

OpsScreen is a static progressive web app for **training-only** humanitarian intake practice using **synthetic data only**. It is designed for classroom, lane, and instructor-led exercises and intentionally avoids live operational workflows.

## Safety boundaries

- No live operational, intelligence, detainee, or prisoner data
- No coercive questioning or interrogation guidance
- No targeting recommendations, threat labels, or risk scoring
- No backend or remote sync by default; data stays in local browser storage

## Features

- Offline-capable PWA with install prompt and service worker caching
- Mock screening sheet for humanitarian intake scenarios
- Local save, edit, duplicate, search, print, and delete flows
- JSON and CSV export for training review
- Prominent training banners and synthetic-data confirmation

## Project structure

- `index.html` - app shell and intake workflow
- `styles.css` - responsive visual system
- `app.js` - local data model and UI logic
- `service-worker.js` - offline caching
- `manifest.webmanifest` - install metadata
- `assets/` - provided OpsScreen branding and generated icons

## Local use

Because this is a static app, you can serve it with any basic web server. Examples:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Vercel

This repo is ready to deploy as a static site on Vercel with no build command required.

Suggested settings:

- Framework preset: `Other`
- Build command: leave empty
- Output directory: `.`

## Notes

If you later want a hosted multi-user version, keep the same training-only boundaries and add authentication plus encrypted storage before introducing any remote persistence.
