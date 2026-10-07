# GoServe architecture and migration

One account system and delivery engine serve all service types. Sign-in never asks for a role. Registration asks for account type; partner approval and all operational permissions are enforced by the API.

## Working entry points

| Path | Responsibility | Implementation today |
| --- | --- | --- |
| apps/customer-web | Public website, shared login, account workspaces | Next.js HTTP gateway serving the existing interface |
| apps/admin-web | Operations entry point | Redirects to the central operations workspace |
| apps/business-web | Business entry point | Redirects to the central business workspace |
| apps/customer-mobile | Android and iOS customer distribution | Expo entry point using shared native implementation |
| apps/driver-mobile | Android and iOS partner distribution | Expo entry point using the same native implementation; separate application identifiers |
| services/api | Account, bookings, approvals, dispatch, tracking, support | NestJS hosts the existing delivery engine |
| packages/constants | Service names and delivery state transitions | Used by delivery engine |
| packages/api-client | Versioned API client | Available for new clients |
| packages/web-gateway | Same-origin proxy including live event streams | Used by customer-web |
| database | PostgreSQL schema and checksum-protected migrations | Prepared; not connected to the running engine |
| infrastructure | PostgreSQL and Redis development services | Docker Compose configuration |

## Run locally

Existing preview: `npm start` on port 8000. Existing data remains in `data/goserve.sqlite`.

Monorepo preview, in two terminals:

```powershell
$env:PUBLIC_ORIGIN='http://localhost:3000'
npm run start:api
```

```powershell
npm run dev:web
```

The customer website runs on port 3000 and proxies to the NestJS API on port 3001. Do not set the public origin to the internal API URL. For phone access, set PUBLIC_ORIGIN and EXPO_PUBLIC_API_URL to the public/LAN web origin and expose the API only through that gateway.

Run the native app with `npm run start -w @goserve/customer-mobile` or `npm run start -w @goserve/driver-mobile`. Both use the shared sign-in form. Only sign-up asks for account type. Background location requires a development or signed native build and explicit permission during an active partner job.

## Database preparation

Docker and PostgreSQL executables are not installed on the current machine. On a machine with Docker Compose:

```powershell
$env:POSTGRES_PASSWORD='<strong local database password>'
docker compose up -d
$env:DATABASE_URL='postgresql://goserve:<URL-encoded password>@localhost:5432/goserve'
npm run db:migrate
```

The schema contains accounts, sessions, deliveries, events, locations, support, approvals, booking idempotency, driver eligibility, payment records, webhook deduplication, and an outbox. Migration application is transactional, locked against concurrent runners, and rejects edits to already-applied migrations.

**Applying this schema does not migrate SQLite data or switch the API to PostgreSQL.** The next implementation step is an asynchronous PostgreSQL repository with transaction/race tests, followed by a controlled data import. Preserve the existing database until that import is verified.

## Ordered remaining work

1. Replace SQLite access with PostgreSQL repositories; validate concurrent dispatch and existing-data import.
2. Add Redis-backed rate limiting and BullMQ outbox workers with retries and provider integrations.
3. Add authenticated Socket.IO tracking subscriptions; current live updates use authenticated SSE and native polling.
4. Build restaurant menus and inventory, ride quotes, parcel sizing, and vehicle eligibility on the common delivery engine.
5. Integrate OTP, Razorpay checkout and signed webhooks, notifications, and verified partner onboarding.
6. Migrate the existing web interface into reusable React components without changing shared authentication.
7. Finish native dependency remediation, physical-device tracking checks, signing, backups, monitoring, and release deployment.

This is an incremental migration. NestJS currently hosts the existing engine rather than independent NestJS domain modules; the web apps do not yet have separate React dashboards. Redis queues, JWT, automated payments and push notifications are not implemented. No production deployment has been performed.
