# Agoloso Motors

**Live: [agoloso-motors.onrender.com](https://agoloso-motors.onrender.com)** (free hosting: the first visit after a quiet spell can take up to a minute to wake up)

A full-stack car dealership platform: a public website where customers browse stock, book test drives and apply for finance, and an admin dashboard where staff manage inventory, enquiries and applications.

**Stack:** Node.js · Express 5 · PostgreSQL (Supabase) · vanilla JavaScript (ES modules) · zod · JWT

## Features

**Customer website**
- Cinematic homepage with background video, scroll-revealed photos, parallax panels and a hamburger menu on phones (all motion is turned off for visitors who ask for reduced motion)
- Car search with filters (make, body type, fuel, gearbox, price, year), sorting and pagination; filters live in the URL so searches can be shared
- Car detail pages with a photo gallery, specs and three forms: ask a question, book a test drive, apply for finance
- Live finance calculator (amortised loan formula, shared by browser and server)

**Admin dashboard** (`/admin`)
- Overview with stock value, new enquiries, upcoming test drives and pending finance applications
- Add, edit, feature, reserve, sell and delete cars
- Enquiry inbox and finance applications with status tracking and internal notes
- Staff accounts with two roles: **staff** (manage cars, enquiries, finance) and **admin** (also manage staff and delete records)

**Backend**
- REST API with request validation (zod) and plain-language error messages
- Versioned SQL migrations with a migration lock, and an idempotent seed script
- Passwords hashed with bcrypt; JWT sessions; role-based access control
- Rate limiting on sign-in and public forms, a spam honeypot, Helmet security headers and a strict Content Security Policy
- Row-level security enabled on every table, so Supabase's auto-generated public API can't read the data
- Prices and interest rates are always taken from the database, never trusted from the browser
- 20 end-to-end API tests against a real Postgres database

## Run it locally

You need **Node.js 20+** and a PostgreSQL database (a free [Supabase](https://supabase.com) project works).

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and fill it in (see [Connect Supabase](#connect-supabase) below).
3. Create the tables, then the first admin account and sample cars:
   ```bash
   npm run migrate
   npm run seed
   ```
4. Start the server (restarts automatically when you edit files):
   ```bash
   npm run dev
   ```
5. Open http://localhost:5000 for the website and http://localhost:5000/admin to sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from your `.env`.

## Connect Supabase

1. Create a project at [supabase.com](https://supabase.com) and save the database password.
2. Go to **Project Settings → Database → Connection string**, choose **Session pooler**, and copy the URL into `DATABASE_URL` (put your password in place of `[YOUR-PASSWORD]`).
3. On the same page under **SSL Configuration**, download the certificate, save it in this folder as `prod-ca-2021.crt`, and set `DATABASE_CA_CERT=./prod-ca-2021.crt`. This lets the server verify it is really talking to Supabase.
4. Run `npm run migrate` and `npm run seed`.

## Deploy (Render)

The website and API are served by the same Express app, so one web service is enough.

1. Push this repository to GitHub.
2. On [render.com](https://render.com), create a **Web Service** from the repository:
   - Build command: `npm ci`
   - Start command: `npm run migrate && npm start`
3. Under **Environment**, add every variable from `.env.example`. For `DATABASE_CA_CERT`, paste the certificate's text instead of a file path. Set `NODE_ENV=production`.
4. Render uses the same Supabase database, so the admin account and sample cars you created with `npm run seed` during setup are already there.

## Tests

The tests create and wipe tables, so give them their own empty database:

```bash
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/agoloso_test npm test
```

Without `TEST_DATABASE_URL` the suite is skipped.

## API overview

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/health` | Public |
| GET | `/api/config` | Public |
| GET | `/api/vehicles`, `/api/vehicles/makes`, `/api/vehicles/:id` | Public (staff also see sold cars) |
| POST, PATCH | `/api/vehicles`, `/api/vehicles/:id` | Staff |
| DELETE | `/api/vehicles/:id` | Admin |
| POST | `/api/leads` | Public (rate limited) |
| GET, PATCH | `/api/leads`, `/api/leads/:id` | Staff |
| GET | `/api/finance/quote` | Public |
| POST | `/api/finance/applications` | Public (rate limited) |
| GET, PATCH | `/api/finance/applications`, `/api/finance/applications/:id` | Staff |
| POST | `/api/auth/login` | Public (rate limited) |
| GET | `/api/auth/me` · PUT `/api/auth/password` | Signed in |
| GET, POST, DELETE | `/api/auth/users` | Admin |
| GET | `/api/stats` | Staff |

## Project structure

```
src/
  server.js            starts the HTTP server
  app.js               Express app: security headers, routes, static site
  config.js            reads settings from the environment
  db/
    index.js           Postgres connection pool
    migrate.js         applies migrations/*.sql in order
    seed.js            first admin account + sample cars
    migrations/        versioned SQL schema
  middleware/          auth (JWT + roles), validation, rate limits, errors
  routes/              auth, vehicles, leads, finance, stats
  lib/finance.js       repayment formula
public/
  index.html           homepage
  vehicle.html         car detail page
  admin/               dashboard and sign-in page
  css/                 site.css (shared + public site), admin.css
  js/                  page scripts; motion.js handles animation and the mobile menu
test/api.test.js       end-to-end API tests
```

## Media credits

Sample car photos ([Unsplash](https://unsplash.com)) and background videos ([Mixkit](https://mixkit.co)) are free-licence stock media, stored in `public/media/` so the site serves them itself. Replace them with photos of your own stock before going live. To change a background video, replace the file in `public/media/videos/` with a short, muted clip.
