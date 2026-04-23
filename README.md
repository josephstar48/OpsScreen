# OpsScreen

OpsScreen is a progressive web app for **training-only** humanitarian intake practice using **synthetic data only**. It includes a browser client, a lightweight Node backend, a file-backed JSON database, and an audit log for classroom review.

## Safety boundaries

- No live operational, intelligence, detainee, or prisoner data
- No coercive questioning or interrogation guidance
- No targeting recommendations, threat labels, or risk scoring
- Records are explicitly marked as synthetic training data
- The backend is intended for local or lab training environments only

## Full-stack features

- Offline-capable PWA with service worker caching and install prompt
- Training intake workflow for mock humanitarian screening sheets
- Node API with CRUD endpoints for records and a health endpoint
- File-backed JSON database in `data/opsscreen-db.json`
- Append-only audit log in `data/audit-log.json`
- API-first frontend with local-storage fallback when offline
- JSON and CSV export for instructor review

## Project structure

- `index.html` - app shell and intake workflow
- `styles.css` - responsive visual system
- `app.js` - client logic, API sync, and offline fallback
- `server.js` - local Node server and REST API
- `data/` - file-backed training database and audit log
- `service-worker.js` - offline caching
- `manifest.webmanifest` - install metadata
- `assets/` - provided OpsScreen branding and generated icons

## API surface

- `GET /api/health` - backend health and mode
- `GET /api/records` - list all saved records
- `POST /api/records` - create a record
- `PUT /api/records/:recordId` - update a record
- `DELETE /api/records/:recordId` - delete a record
- `GET /api/audit-log` - recent audit entries

## Local use

Use Node so both the frontend and backend run together:

```bash
cd /Users/joestar48/Desktop/MyProjects/OpsScreen
node server.js
```

Then open `http://localhost:4173`.

You can also use:

```bash
npm start
```

## Database notes

- The database is a JSON document stored at `data/opsscreen-db.json`.
- The audit log is stored at `data/audit-log.json`.
- This is appropriate for local training and demos, not for production multi-user hosting.

## Vercel

The current backend writes to the local filesystem, which works for local Node hosting but is not durable on Vercel serverless runtime. For Vercel deployment:

- The frontend can deploy as-is.
- Durable backend persistence should be swapped to a managed datastore such as Vercel Postgres, Neon, Supabase, or another external database.
- The API and UI boundaries in this repo are already separated so the storage adapter can be replaced later without redesigning the client.

## Next hardening steps

- Add login and role-based access before any shared-host deployment
- Encrypt data at rest if you move beyond synthetic classroom use
- Replace the JSON database with a managed relational database for persistent hosting
