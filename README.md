# Campus Events

Starter project for **Advanced Development** (Thomas More – International Experience Design, year 3).

A small but complete web app: students browse campus events and register for them.

- **api/** : REST API: Node.js, Express 5, Sequelize + SQLite, Zod
- **web/** : frontend: Vue 3, Vue Router, Vite

It works out of the box, and it has tests. It is also the kind of code you will meet in your first job:
the whole API is one long file. Your job is to **clean it up, ship it to production, fix it and add the hard
parts**

## Quick start

You need **Node.js 22.12 or newer** (`node -v`) and Git.

```bash
git clone <your-fork-url>
cd campus-events
npm install        # installs api + web in one go
npm run dev        # starts both
```

Open **http://localhost:5173**. The API runs on http://localhost:3000/api.
The first start fills the database with demo events. `npm run seed` resets it.

Later parts need a few services. You never need them to run the tests.

| Service | Local | Setting in `api/.env` |
|---|---|---|
| RabbitMQ | `docker compose up -d rabbitmq` | `AMQP_URL` |
| Redis | `docker compose up -d redis` | `REDIS_URL` |
| Identity provider | a free Auth0 tenant | `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_CLIENT_ID` |

## Scripts (run from the root folder)

| Script | What it does |
|---|---|
| `npm run dev` | API + frontend with auto-reload |
| `npm test` | All tests: API (node:test + supertest) and frontend (Vitest) |
| `npm run lint` | ESLint for the whole project |
| `npm run check` | Lint + tests. **The pipeline runs exactly this. It must be green before you hand in.** |
| `npm run seed` | Reset the database to the demo data |
| `npm run build` | Production build of the frontend |

## How it fits together

```
browser ──► web (Vite, :5173) ──/api/*──► api (Express, :3000) ──► SQLite (api/data/events.sqlite)
```

In development Vite forwards every `/api/...` request to the API (see `web/vite.config.js`),
so the browser only talks to one address and you don't need CORS.

### api/

**Today** the whole API lives in one file:

```
api/src/app.mjs      settings, database + models, validation, routes, business rules, error handling
api/src/server.mjs   starts the app (and adds demo data to an empty database)
api/src/seed.mjs     npm run seed: reset the database
```

Prefered:

```
routes/        URL + validation → controller        (no logic)
controllers/   HTTP in/out, picks the status code    (thin)
services/      business rules, throws AppErrors      (no Express, no SQL)
repositories/  data access via Sequelize             (no rules)
models/ db/    tables, connection, demo data
config/        the only place that reads process.env
```

The integration tests in `api/tests/integration` only talk HTTP. They pass before your refactoring,
and they must still pass after it, without changing them.

| Method | URL | |
|---|---|---|
| GET | `/api/health` | Health check |
| GET / POST | `/api/events` | List / create |
| GET / PATCH / DELETE | `/api/events/:id` | One event (incl. `registered`, `spotsLeft`) |
| GET / POST | `/api/events/:id/registrations` | List / register `{ name, email }` |
| GET | `/api/stats` | Occupancy per event |

Errors always have this shape: `{ "error": { "code", "message", "details?" } }`.

### GET response caching

The API uses a bounded in-memory response cache built with JavaScript's `Map`.
Redis is available in Compose for later exercises, but no Redis client is installed.
This implementation adds no dependencies and needs no external cache service;
Redis downtime has no effect on it.

| Cached GET endpoint | Response |
|---|---|
| `/api/events` | Events in their existing start-date order |
| `/api/events/:id` | Event details, registration count and spots left |
| `/api/events/:id/registrations` | Registrations in their existing creation order |
| `/api/stats` | Occupancy and status per event |

Health checks are never cached, so they still check the database every time.
ID validation runs before cache lookup. Only successful HTTP 200 JSON responses
are stored; validation errors, missing resources and server errors are not cached.
HEAD requests bypass the cache. No new query filtering or sorting is introduced.
Keys include the complete request URL, including query parameter values, repeated
parameters and their order. Different query strings use different entries.

Configure these optional settings in `api/.env`, then restart the API:

| Setting | Default | Meaning |
|---|---|---|
| `CACHE_ENABLED` | `true` | Set to `false` to bypass response caching |
| `CACHE_TTL_MS` | `30000` | Maximum entry lifetime in milliseconds |
| `CACHE_MAX_ENTRIES` | `500` | Maximum number of cached responses |

Invalid numeric settings fall back to their defaults. Entries expire on access,
and the oldest inserted entry is evicted when the size limit is reached.
Statistics expire earlier when an open event's start time passes, so the cached
status can change to `past` without a database write. The existing precedence of
`full` over `past` stays unchanged.

For simplicity, every successful event POST, PATCH, DELETE or registration POST
invalidates **all** cached GET responses, including query variants. Registration
invalidation happens immediately after saving and before sending email. Rejected
mutations leave the cache intact. Invalidation advances a generation number before
clearing storage: old keys remain unusable if clearing fails, and reads already in
progress cannot repopulate the new generation with older results. Cache read/write
failures are logged and requests fall back to the database. A cache failure does
not undo a successful mutation.

To test locally, start the app normally; no Redis or Docker is needed. Request
`GET /api/events` twice in the browser Network panel, then create or edit an event
and request it again. The updated data should appear immediately. Register someone
and check event details, registrations and statistics again; then delete the event
and confirm its detail and registration endpoints return 404. To observe reuse,
set a debugger breakpoint in `eventRepository.listEvents`: the second identical
GET should skip it, while a different query string, mutation or expiry causes a
database read. With `CACHE_ENABLED=false`, both requests reach the repository.
`npm.cmd run check` includes automated tests for these cases plus cache failures,
capacity eviction and overlapping reads/writes; existing email tests still run.

This cache is intended for **one API process**. Restarting discards it. Multiple
API processes do not share invalidation, and external database edits or running
`npm run seed` in another process require restarting the API (or disabling caching)
to guarantee immediate freshness. In-process database initialization/reset also
invalidates entries. A request overlapping a write may return its earlier snapshot,
but cannot cache that snapshot after the write. TTL limits the lifetime of data
changed outside the API; it is not a substitute for shared invalidation. The size
limit counts entries rather than bytes. There is no request coalescing on concurrent
cache misses. A multi-instance deployment would need a shared invalidation strategy.

### Registration confirmation emails

Email is disabled by default. The registration service first saves the registration,
then asks `api/src/mail/confirmationMailer.mjs` to send a plain-text confirmation
using the existing Nodemailer dependency. Controllers and repositories do not send mail.
SMTP configuration is read only in `api/src/config/env.mjs`.

To test locally without sending messages to real inboxes:

1. Run `docker compose up -d mailpit` from the repository root. This optional service
   captures mail locally; no forwarding to an external mail server is configured.
2. Copy `api/.env.example` to `api/.env` if needed. Set `MAIL_ENABLED=true`,
   `MAIL_FROM=Campus Events <events@campus.example>`, `SMTP_HOST=localhost`,
   `SMTP_PORT=1025`, and `SMTP_SECURE=false`. Leave `SMTP_USER` and
   `SMTP_PASSWORD` empty. Keep `NODE_ENV=development`.
3. Start or restart the API with `npm run dev -w api` from the root (or use
   `npm run dev` for both the API and frontend). Register for an event.
4. Open http://localhost:8025 to inspect the captured confirmation. The SMTP and
   browser ports are bound to localhost only.
5. Run `docker compose stop mailpit` and register a different email address.
   Registration must still return HTTP `201`, appear in the registration list,
   and update the seat count. The API logs a `Confirmation email failed` warning.

For a hosted SMTP provider, configure its host, port, sender address and credentials
in `api/.env`. Typically port 587 uses `SMTP_SECURE=false` with STARTTLS, while
port 465 uses `SMTP_SECURE=true` for immediate TLS. Certificate validation stays
enabled. Never commit credentials. Restart the API after changing settings.

`SMTP_TIMEOUT_MS` defaults to 5000 milliseconds and configures DNS, connection,
greeting and socket inactivity timeouts. It is not an overall request deadline.
Mail configuration is validated only when sending is attempted, so invalid mail
settings do not prevent API startup. If sending fails or SMTP is offline, the
service catches the error and returns the saved registration with the same `201`
response. The registration is never rolled back because of an email failure.
Warnings include registration/event identifiers and an error code, without SMTP
credentials or the email body.

Delivery is best effort: failed messages are not retried, and a process crash
between saving and sending can lose a confirmation. SMTP acceptance does not
guarantee inbox delivery. A slow provider delays the response until sending finishes
or a transport timeout occurs. RabbitMQ is not required for this implementation;
the existing `api/lab/` scripts remain separate classroom exercises. Reliable
eventual delivery would require a persistent outbox and retry worker.

Run `npm.cmd run check` on Windows (or `npm run check` elsewhere). Tests always
disable the configured SMTP mailer when `NODE_ENV=test`, even if `MAIL_ENABLED=true`
or SMTP credentials are inherited. Additional HTTP integration tests use fake
transports to verify sending after persistence, SMTP/configuration failures, and
rejected registrations. No Mailpit, RabbitMQ, or real SMTP account is needed for tests.

### web/

```
api/          client.js (fetch + ApiError) and events.js (one function per endpoint)
views/        one component per page, registered in router.js
components/   reusable pieces: EventCard, SeatMeter, RegistrationForm, ErrorMessage
styles.css    design tokens at the top, change those first
```
