# GoServe backend setup and release status

The repository currently has two backend runtimes. `server.mjs` serves the working local website at port 8000 using SQLite. `services/api` is the expanded NestJS API at port 4000 using PostgreSQL, Redis, Prisma and Bull. The website and Expo client still call the port 8000 API. Do not point production traffic at port 4000 until the client contract and existing user/order data have been migrated.

## Local website and mobile flow

1. Install dependencies with `npm ci`.
2. Start the existing website and API with `npm start`.
3. Open `http://localhost:8000`. The login page is shared across account types; role selection belongs on sign-up.
4. Run the Expo application from `mobile/` with its documented Expo commands. A physical device requires the machine's reachable LAN address, not `localhost`.

The local parcel flow now issues a short-lived delivery code to the customer after pickup. The partner enters that code to complete handover. This flow uses the SQLite API and does not depend on third-party maps or payment credentials.

## Expanded API development

1. Set `POSTGRES_PASSWORD` and start PostgreSQL and Redis using `docker compose up -d`.
2. Copy `.env.example` to `.env`. Set `DATABASE_URL` to the same PostgreSQL password. Set separate random JWT secrets of at least 32 characters each. Do not commit `.env`.
3. Run `npm run generate:db` and `npm run db:migrate:prod` to apply the checked-in Prisma migration.
4. Start the API with `npm run dev:api`. Health endpoints are under `/api/v1/health`; interactive API docs are at `/api/docs` in development.

The API refuses to start in production mode with missing or short JWT secrets. SMS, maps, push, object storage, payment providers and provider webhooks require real project credentials. Their absence is a service configuration issue, not a valid production fallback. Set `CORS_ORIGINS` to exact HTTPS website origins before deployment.

## Remaining release gates

- Connect the website and both native roles to one versioned API contract; migrate legacy SQLite accounts and orders with a reversible data migration.
- Replace placeholder route estimates and parcel prices with server quotes and a defined service zone. Add map, navigation and background location behavior for physical Android and iPhone devices.
- Reconcile wallet and refund money using exact currency units and an immutable ledger. Verify Razorpay/Stripe settlement and webhook retry behavior with sandbox credentials.
- Implement reliable outbox delivery between database changes and queues, plus stuck-job reconciliation, operational alerts and backup/restore drills.
- Review role and object permissions across all modules, upload handling, partner onboarding, cancellation and return workflows. Review privacy, transport, tax and food requirements for the chosen Indian launch city.
- Run clean builds, database migration rehearsal, provider integration checks and full journey checks on real devices before accepting live bookings.

Passing a TypeScript build or running the local demo does not certify a production launch. No public deployment, production keys or app-store release is included here.
