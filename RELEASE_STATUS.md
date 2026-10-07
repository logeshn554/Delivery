# GoServe release status

## Implemented and checked

- Shared website login at `/login`, registration at `/signup`; account type is asked only when registering.
- Role-based workspace selection after login; administrator roles cannot be self-registered.
- Responsive website, installable PWA, and native Android/iPhone source with one shared login flow.
- Persistent accounts, secure password hashes, expiring cookie/mobile bearer sessions, origin checks and private-file allowlist.
- Service requests, booking retry protection, history, cancellation of unassigned jobs, partner approvals/suspension, atomic acceptance and operations reassignment.
- Status history, active-job location sharing, authenticated live web events, optional Google Maps tracking, Google navigation handoff.
- Native secure sessions and background partner location implementation.
- Support tickets, operations resolution, deployment container and environment examples.

Backend integration checks and JavaScript syntax checks pass. Android and iOS Hermes bundles export successfully using compatible Expo SDK 57 dependencies. The shared login/sign-up UI was inspected in the browser. Bundle checks do not constitute native device tests or signed store builds.

## Remaining launch work

- Select the first Indian launch city, operating area, pricing/cancellation policies, supported vehicles and partner eligibility.
- Configure Maps, OTP/email, payment and notification provider accounts through secure environment settings.
- Complete automatic quotes, checkout/webhooks/refunds, identity verification/recovery and KYC/document workflows.
- Complete food menus/cart/merchant preparation, vehicle condition/proof capture, delivery OTP/photo proof, business bulk shipments, ratings and incentives.
- Review privacy retention, backups, load handling, observability, availability and incident response. Migrate the experimental Node SQLite implementation to the chosen production database before scaling.
- Validate native tracking on real Android and iPhone devices, including network loss, permissions, battery policies, app termination and session expiration.
- Configure signing/store accounts, finalize app identity/assets, publish the backend/website, and conduct staged rollout.

## Dependency findings

The native dependency audit initially reported 22 affected entries. A scoped `xcode → uuid ^11.1.1` override fixed the seven moderate reports; compatible app bundles still export.

The audit still reports 15 high-severity affected entries inherited from two underlying advisories in `braces` and `node-forge`. Registry checks found their latest releases still covered by those advisory ranges. These reports are concentrated in Expo/Metro/native build dependencies; the backend uses Node built-ins. The remaining reports must be resolved or formally assessed with supported upstream fixes before production release. No forced downgrade to incompatible Expo/React Native versions was applied.

Sources: [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv), [UUID advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

The current state is a functioning development platform with unfinished modules and release requirements. It is not approved to accept real production orders.
