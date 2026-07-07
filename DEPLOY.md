# Deploying Padel Platform

Three parts:

- **Supabase** — database, auth, storage. Already hosted; nothing to deploy.
- **Backend** (`backend/`) — FastAPI → **Railway**.
- **Frontend** (`web/`) — Vite/React static site → **Vercel**.

Deploy the **backend first** so you have its public URL to give the frontend.

---

## 0. Push the code to GitHub

Both Railway and Vercel deploy from a GitHub repo.

```bash
cd /Users/thanzap/workspace/padel_platform
git init
git add .
git commit -m "Initial commit"
# create an empty repo on github.com first, then:
git remote add origin https://github.com/<you>/padel-platform.git
git branch -M main
git push -u origin main
```

> The root `.gitignore` already excludes `backend/.env` and `web/.env.local`.
> **Confirm they are NOT in the commit** — secrets go in the Railway/Vercel
> dashboards, never in git. Check with `git status` before pushing.

---

## 1. Backend → Railway

1. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo** → pick this repo.
2. Open the service → **Settings**:
   - **Root Directory**: `backend`
   - Start command is read from `backend/Procfile` (no need to type it).
3. **Variables** tab — add (copy values from your local `backend/.env`):
   | Key | Value |
   |---|---|
   | `DATABASE_URL` | `postgresql+asyncpg://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres` |
   | `SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `SUPABASE_JWT_SECRET` | (from Supabase → Settings → API → JWT Secret) |
   | `CORS_ORIGINS` | *(set after step 2, once you have the Vercel URL)* |
4. **Settings → Networking → Generate Domain**. You get e.g.
   `https://padel-backend-production.up.railway.app`. Copy it.
5. Verify: open `<railway-url>/health` → should return `{"status":"ok"}`.

---

## 2. Frontend → Vercel

1. [vercel.com](https://vercel.com) → **Add New → Project** → import this repo.
2. **Root Directory**: `web` (Vercel auto-detects Vite; `vercel.json` handles the
   rest, including SPA fallback for deep links like `/sessions/:id`).
3. **Environment Variables**:
   | Key | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | (from `web/.env.local` — safe to expose) |
   | `VITE_API_URL` | your Railway URL from step 1.4, e.g. `https://padel-backend-production.up.railway.app` |
4. **Deploy**. You get e.g. `https://padel-platform.vercel.app`.

> `VITE_API_URL` is **required in production** — locally it's unset and the Vite
> proxy handles routing, but there is no proxy in prod, so the frontend must call
> the Railway backend directly.

---

## 3. Wire the two together (CORS + Supabase Auth)

1. **Railway** → Variables → set `CORS_ORIGINS` to your Vercel URL
   (comma-separated, no trailing slash), then redeploy:
   ```
   https://padel-platform.vercel.app
   ```
2. **Supabase dashboard** → **Authentication → URL Configuration**:
   - **Site URL**: `https://padel-platform.vercel.app`
   - **Redirect URLs**: add `https://padel-platform.vercel.app/**`
   Otherwise sign-in / email-confirmation redirects break in production.

---

## 4. Smoke test

- Open the Vercel URL → landing page loads.
- Sign up / sign in → reaches a dashboard.
- Open a session, then reload that URL in a fresh tab → the app loads (SPA
  fallback), not a JSON error.

## Redeploying

Push to `main` → both Railway and Vercel auto-build and redeploy.

## Database migrations

Schema changes live in `supabase/migrations/`. Apply new ones via the Supabase
SQL editor (or the Supabase CLI) — they are not run automatically on deploy.
