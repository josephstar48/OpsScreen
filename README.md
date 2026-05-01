# OpsScreen

OpsScreen is a progressive web app for **training-only** humanitarian intake practice using **synthetic data only**. It uses **Vercel Functions** for the backend and a **managed Postgres database** for durable hosted persistence, and now includes a **multi-organization platform model**.

## Safety boundaries

- No live operational, intelligence, detainee, or prisoner data
- No coercive questioning or interrogation guidance
- No targeting recommendations, threat labels, or risk scoring
- Records are explicitly marked as synthetic training data
- Backend persistence is for classroom and exercise data only

## Hosted full-stack features

- Offline-capable PWA with service worker caching and install prompt
- Vercel Function API routes under `api/`
- Managed Postgres persistence via `POSTGRES_URL` or `DATABASE_URL`
- Email/password authentication with signed HttpOnly session cookies
- Automatic schema bootstrap on first API request
- Audit logging in Postgres for create, update, and delete actions
- API-first frontend with local-storage fallback when offline
- JSON and CSV export for instructor review
- Super admin, org admin, and member role views derived from the signed-in user
- Organizations for units/companies and scenarios scoped inside each organization
- Organization join codes and scenario join codes for classroom onboarding

## Project structure

- `index.html` - app shell and intake workflow
- `styles.css` - responsive visual system
- `app.js` - client logic, API sync, and offline fallback
- `api/` - Vercel Functions for health, records, and audit log routes
- `lib/db.js` - Postgres pool and schema bootstrap
- `lib/record-utils.js` - record validation and normalization
- `service-worker.js` - offline caching for static assets only
- `manifest.webmanifest` - install metadata
- `assets/` - provided OpsScreen branding and generated icons

## Multi-tenant model

- `Super Admin`
  Views all organizations and users, activates/deactivates organizations, and assigns or removes org admins.
- `Organization Admin`
  Manages only their own organization, creates scenarios, adds users, and assigns org-level roles.
- `Users / Members`
  Join an organization, join scenarios within that organization, and submit their own screening sheets.
- `Scenarios`
  Shared environments nested under a single organization. Records are submitted against the active scenario context.

The current app uses first-party email/password authentication. Users gain organization and scenario access through join codes or admin assignment.

## API surface

- `GET /api/health` - backend health and database connectivity
- `GET /api/auth` - current signed-in account
- `POST /api/auth` - sign up, sign in, or sign out
- `GET /api/platform` - authenticated user’s scoped organizations, users, memberships, and scenarios
- `POST /api/platform` - authenticated role-aware organization/user/scenario actions
- `GET /api/records` - list all saved records
- `POST /api/records` - create a record
- `PUT /api/records/:recordId` - update a record
- `DELETE /api/records/:recordId` - delete a record
- `GET /api/audit-log` - recent audit entries

## Database model

The app bootstraps these core tables:

- `opsscreen_users`
- `opsscreen_organizations`
- `opsscreen_org_memberships`
- `opsscreen_scenarios`
- `opsscreen_scenario_memberships`
- `opsscreen_records`
- `opsscreen_audit_log`

It also seeds a demo super admin, two demo organizations, sample org admins, sample members, and starter scenarios so the platform is usable immediately.

## Vercel deployment

This version is shaped for Vercel hosting, but it needs a Postgres integration attached to the Vercel project.

### 1. Import the repo into Vercel

- Create a new Vercel project from `josephstar48/OpsScreen`
- Framework preset: `Other`
- Build command: leave empty
- Output directory: leave empty

### 2. Add a Postgres integration

Per Vercel’s current docs, new Postgres databases are provisioned through **Marketplace Storage** providers such as **Neon**, **Supabase**, or **AWS Aurora Postgres**. Vercel injects the database credentials into the project as environment variables. Source:

- Vercel Marketplace Storage docs: https://vercel.com/docs/marketplace-storage
- Vercel Postgres docs: https://vercel.com/docs/postgres

The code supports either:

- `POSTGRES_URL`
- `DATABASE_URL`

It also requires:

- `AUTH_SECRET` - at least 32 random characters for signing session cookies

### 3. Deploy

After the integration is attached, deploy the project. The first API request will create the required tables automatically.

## Local development

For local development with the same Vercel-compatible backend shape:

```bash
cd /Users/joestar48/Desktop/MyProjects/OpsScreen
npm install
npx vercel dev
```

Then open `http://localhost:3000` unless Vercel prints a different port.

To pull local development env vars from your Vercel project, Vercel’s docs recommend:

```bash
vercel env pull
```

Source: https://vercel.com/docs/environment-variables

## Important note

`python3 -m http.server` is no longer sufficient for the full app, because it only serves static files and does not run the Vercel API routes.

## Next hardening steps

- Add password reset / email verification through a hosted auth provider or transactional email flow
- Add formal invite links for admin-created users
- Add encryption or field-level redaction if you expand beyond synthetic classroom data
- Add formal SQL migrations instead of runtime bootstrap if you want tighter release control
