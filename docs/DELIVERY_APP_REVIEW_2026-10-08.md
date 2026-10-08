# GoServe delivery platform review

Reviewed 8 October 2026. This is a source and product review, not production certification or a penetration test. Application code was not changed during this review.

## Assessment

GoServe has a working development flow for accounts, generic service requests, manual/partner dispatch, status changes, location sharing and support. It also has a newer NestJS/Prisma implementation with broader modules. These implementations are not yet one verified product. A polished homepage and a large module tree do not establish that real deliveries and money can be handled reliably.

The immediate objective should be one complete parcel delivery journey in one Indian city. Extend the common delivery engine to food, rides, business shipments and vehicle transport after that journey is dependable. Keep one login page; ask account type only at registration. Privileged roles must always be assigned through authorized operations.

## Evidence and limits

- Inspected the current localhost homepage, legacy API/client/native source, newer NestJS authentication, payments, wallet, dispatch, tracking, notifications and upload code, database definitions and workspace scripts.
- Ran the existing four Node test groups. They all pass when local socket access is permitted. The first restricted run could not connect to its temporary localhost server; that was an environment error.
- These tests cover the legacy engine and shared client/constants. They do not validate the newer NestJS/Prisma service.
- The root TypeScript compiler is not installed, so a fresh NestJS typecheck was not performed. Source inspection nevertheless found concrete missing service methods.
- Did not make real bookings, process real payments, send SMS, run a production database migration, or test physical phones.
- Earlier dependency findings need a fresh audit after the package manager and lockfile are reconciled; old advisory counts are not a current security assessment.

## Priority-zero findings: resolve before any real orders

| Finding | Evidence | Required correction |
| --- | --- | --- |
| Admin actions lack role authorization | `services/api/src/modules/admin/admin.controller.ts:15` applies JWT authentication only; status changes do not check administrator role. The RolesGuard exists but no registration/use was found in services. | Apply role guards and object permissions; test customer and partner access is denied. Audit each approval/suspension. |
| Refund and payment verification lack caller ownership checks | `payments/payments.controller.ts:33` and `:38` do not pass the authenticated caller into the service. | Restrict refunds to permitted operators/policies; check ownership and payment/order relationship for verification. |
| Payment creation trusts a client amount | `payments/payments.service.ts` uses `dto.amount` in provider requests and stored payment records. | Load the owned booking and an unexpired server quote; derive amount/currency from stored data. |
| Stripe verification is insufficiently bound | `payments/payments.service.ts` retrieves the supplied provider ID and checks success, without comparing it to the stored intent and expected amount/currency. | Bind provider intent, account, currency, amount and order before changing payment state. |
| Webhooks are acknowledgements only | `payments/webhooks/payment-webhook.controller.ts` logs and returns `{received:true}`. | Verify signatures using raw request bytes; durably deduplicate events; process capture/failure/refund states; reconcile missing and reordered events. |
| Tracking room access lacks booking authorization | `tracking/gateway/tracking.gateway.ts:168` joins a caller-specified room without verifying ownership/assignment. | Authorize each subscription, validate payloads, and revoke access on reassignment, completion, suspension and session expiry. |
| Record lookups lack object authorization | `packages/packages.controller.ts` passes only the requested ID to `findById`; the service returns recipient and driver data. Similar lookup patterns need review across rides and tracking. | Pass the caller through and enforce owner/assigned partner/authorized staff scope. |
| Dispatch acceptance is not atomic | `dispatch/dispatch.service.ts:145` reads availability then performs separate writes; attempt identity, expiry and recipient are not checked together. | Transactional conditional claim with database constraints; validate driver, dispatch and offer relationship. Race-test simultaneous acceptance. |
| Dispatch controller mixes user and driver identifiers | `dispatch/dispatch.controller.ts:35` passes `user.id` where the service updates a Driver by ID. | Resolve the approved driver profile server-side and enforce driver role/eligibility. |
| Wallet can lose concurrent updates | `wallet/wallet.service.ts` reads balance then writes an absolute new balance inside a transaction without a locking/serialization strategy. Money fields use Float in Prisma. | Integer paise or exact decimal, atomic conditional debits, immutable ledger entries and unique operation IDs. Test concurrent debit/refund/retry. |

These are code findings in the newer backend. Its runtime/build is not established; the report does not claim the vulnerabilities were exercised on a deployed service.

## Integration and correctness blockers

1. **Choose one application contract and runtime.** Legacy clients use email/password, opaque sessions, lowercase roles and `/orders`; the newer backend uses phone OTP, JWT, uppercase roles and service endpoints. Create an explicit migration map, compatibility adapter and contract tests before switching clients.
2. **Repair workspace commands.** Root database commands filter `@delivery/database` and call Prisma-style commands; the database package is named `@goserve/database` and exposes only `migrate`. Root pnpm configuration and prior npm artifacts must become one reproducible install/build path.
3. **Complete the new backend service contracts.** Auth calls `UsersService.create`, which is absent. Tracking gateway calls `TrackingService.updateDriverLocation`, absent in the inspected service. Generate Prisma, typecheck and fix all remaining schema/type/module mismatches.
4. **Finish OTP correctly.** Twilio Verify sends its own code, but verification currently compares against a separately generated database code. Choose provider-managed verification or locally generated cryptographically secure, hashed OTPs with atomic one-time consumption. Avoid Math.random. Restrict public role selection: the DTO currently accepts the whole enum including ADMIN/SUPER_ADMIN. This is a dangerous design path, although the missing user-creation method currently blocks registration.
5. **Wire rate limiting.** Throttle decorators/configuration need an applied guard and a shared store where multiple instances are used. Rate-limit by phone/account and IP without logging OTPs or unnecessary personal data.
6. **Implement queue consumers.** Dispatch enqueues `find-driver`, `driver-timeout` and `find-next-driver`, but no `@Processor` or `@Process` handlers were found under services. Queue registration alone does not assign drivers. Use a durable outbox for database-to-queue delivery and idempotent consumers.
7. **Replace placeholder uploads.** UploadsService returns invented storage URLs. Implement real signed uploads, object ownership, size/type checks, malware controls where appropriate and retention for identity/proof documents.
8. **Remove placeholder pricing.** Rides assume 5 km; parcels charge a fixed 60. Replace these with server quotes based on route, zone, vehicle, dimensions, waiting and applicable charges. Tax configuration needs operational/accounting review rather than one hardcoded rate for every service.
9. **Unify completion state.** Assignment, delivery status, payment status and merchant preparation should be separate but coordinated state machines. Events need one naming contract and durable delivery.
10. **Make notification failures visible.** Firebase methods log errors and can return without sending when unconfigured. Track queued/sent/failed outcomes, retry transient failures and alert on exhausted delivery attempts.

## Required customer journey

Serviceable location → pickup/drop pins and complete addresses → sender/receiver details → package type, size, weight and instructions → transparent quote and expiry → payment → confirmed booking → driver assignment → pickup proof → live tracking → delivery proof → receipt → support/refund/rating.

Every step needs loading, validation, retry, empty and failure states. Preserve form input across authentication and network interruption. A request timeout must not create another booking or charge. Explain no-driver and out-of-zone results before taking payment where practical.

Keep the shared login. Allow browsing services before login, authenticate when booking needs an account, show a resend countdown and recovery route, and keep administrator registration unavailable publicly. Saved addresses should include map coordinates, landmark, flat/floor, contact and delivery instructions.

## Required partner journey

Identity and vehicle onboarding → review/approval → online availability → eligible job offer with payout and distance → accept/reject/expiry → navigate to pickup → verify sender/package → pickup confirmation → navigate to delivery → receiver OTP/photo/signature as required → completed job → earnings and payout status.

Add waiting time, customer unreachable, wrong address, unsafe/prohibited package, failed delivery, return-to-origin, emergency support and reassignment workflows. An offline/suspended driver must not receive new jobs. Show only information needed at the current job stage.

## Maps and tracking requirements

- Separate address search/geocoding, road routing/ETA, navigation and live position ingestion. A Google Maps navigation link does not implement the other functions.
- Use Places/map pin confirmation for addresses and Routes/Route Matrix for road distance and ETA. The current straight-line distance at 30 km/h is only a rough fallback and must be labelled accordingly.
- Suggested starting policy: send moving active-job positions about every 5–10 seconds, adapt to battery/network and operational needs, show update age, and flag stale tracking after an agreed threshold such as 30 seconds. These are proposed targets, not current guarantees.
- Include timestamp, sequence, accuracy and job identity. Reject invalid/out-of-order samples and implausible jumps. Do not animate an old position as if it were current.
- Scope customer tracking to their delivery. Share partner location only within disclosed operational purpose; stop customer access when the job ends.
- Validate Android/iPhone background operation with screen locked, navigation open, poor network, denied permission, approximate location, battery saver, process termination and session expiry. No platform should promise uninterrupted tracking after every kind of app termination.
- Use separate restricted client/server keys, budget alerts and graceful Maps outage behavior.

Official references: [Google Routes methods](https://developers.google.com/maps/documentation/routes/reference/rest), [Android background location](https://developer.android.com/develop/sensors-and-location/location/background), [Google Play background location review](https://support.google.com/googleplay/android-developer/answer/9799150).

## Merchant, business and operations needs

| Workspace | Essential capabilities |
| --- | --- |
| Merchant | Opening hours, menu variants/add-ons, inventory, accept/reject, preparation time, ready-for-pickup, cancellations, settlement and disputes |
| Business | Organization membership, staff permissions, bulk shipment validation, duplicate prevention, pickup scheduling, labels, invoices, delivery exports and API/webhook credentials |
| Operations | Live jobs and exception queue, driver approval, dispatch/reassignment, city/zone controls, service pause, support history, bounded refund permissions, audit search and incident handling |
| Partner finance | Expected/actual earnings, commission and adjustments, settlement ledger, failed payout handling and reconciliation |

Food requires restaurant preparation and inventory states. Rides require trip-start verification, passenger safety and vehicle eligibility. Vehicle transport requires condition records and scheduled handover. These should reuse identity, dispatch, tracking, payments and support while retaining their own service rules.

## Reliability and release requirements

- One PostgreSQL system of record with versioned migrations, indexes, backup retention and a demonstrated restore. Keep the current data until migration is reconciled.
- Shared rate limiting/cache and durable job queues; transactional outbox, retries, dead-letter handling and reconciliation jobs.
- Separate development/staging/production credentials; HTTPS, least privilege, secret rotation, redacted logs and scoped document access.
- Versioned API contracts; meaningful integration, concurrent booking/dispatch and provider tests; reproducible CI builds and rollback.
- Monitoring for booking failures, stalled jobs, queue age, stale locations, payment mismatches, notification failures and app crashes.
- Payments: verify signatures, deduplicate events and handle retries/order changes. [Razorpay webhook guidance](https://razorpay.com/docs/webhooks/validate-test/).
- Signed Android/iPhone builds, real-device checks, store disclosures, accessibility, low bandwidth behavior and supported local languages.
- Choose city, operating hours, delivery radius, partner supply, package limits, pricing, cancellation/return policy and support coverage. Obtain applicable local transport, food, privacy, tax and insurance review for the actual launch services; this report makes no legal compliance determination.

## Recommended delivery order and acceptance gates

| Stage | Deliverable | Exit gate |
| --- | --- | --- |
| 1. Stabilize | One package manager, build, API contract and database path | Clean install, typecheck and CI; migration rehearsed; existing accounts/orders preserved |
| 2. Secure | Authorization, OTP, tracking privacy, payment and wallet repairs | Cross-account tests denied; duplicate/refund/replay/concurrent requests have one correct outcome |
| 3. Complete parcel delivery | Quote, payment, eligible dispatch, proof, receipt, support | Full customer/partner/operations journey including no-driver, failed delivery and return scenarios |
| 4. Make operations dependable | Queues, notifications, observability, reconciliation, backups | Restart/network/provider failures recover; restore and alert drills pass |
| 5. Pilot | One city zone with trained partners and staffed support | Measure service outcomes on real devices; resolve incident causes before expanding |
| 6. Expand | Food, rides, business and vehicle transport | Each service passes its own lifecycle, safety, payment and exception tests |

Suggested pilot measures: booking success, assignment time, promised-window completion, cancellation reasons, stale tracking rate, proof coverage, payment reconciliation, refund age, support response, partner earnings and contribution per delivery. Set targets from pilot constraints, not fabricated claims. Financial correctness, access isolation and no duplicate assignments are invariants, not percentage targets.

## Product conclusion

The highest-value next work is a secure, complete parcel-delivery flow using one coherent backend. Retain the single login and current visual identity. Replace generic service requests with guided booking screens, dependable operations and clear failure recovery. Add the remaining services when the common engine can reliably complete and reconcile a real delivery.
