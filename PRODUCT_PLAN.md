# GoServe product plan

**Positioning:** One app for everything that needs to move.  
**Starting assumption:** Begin in one launch city and make the customer experience a responsive installable web app (PWA). This gives us a real website and a phone-friendly app surface while keeping the first release small. A native Android/iOS client can follow once the shared service and tracking APIs are stable.

## Product shape

One account and a consistent order history across five services:

- Food delivery
- Passenger rides
- Person-to-person courier
- Vehicle transport
- Business and e-commerce last-mile shipments

The platform has distinct customer, driver/partner, merchant, business, operations, and support experiences. The website is responsive and shares customer flows with the installable app; operational tools are separate role-gated surfaces.

## Delivery sequence

### Release 0 — Customer foundation (started)

- Responsive customer home, service discovery, and shared visual language
- Installable PWA shell for phone and desktop
- Location-permission entry point and address handoff
- Tracking lookup interaction clearly identified as a demo until backed by real shipment data
- Product plan, architecture boundaries, launch gates, and open dependencies

### Release 1 — One end-to-end service

Start with **courier/package delivery** because it validates addresses, pricing, booking, dispatch, tracking, proof of delivery, notifications, and support without the menu/merchant complexity of food or passenger safety concerns of rides.

- Customer sign-in (phone OTP), saved addresses, package details, quote, booking, cancellation, history
- Driver app: onboarding/KYC, availability, offer accept/reject, pickup/drop workflow, OTP/photo proof
- Operations console: review partners, dispatch/reassign, exceptions, refunds/support queue, audit trail
- Backend API, relational database, role-based access, event history, notifications, and payment provider adapter
- Google Maps Platform: Maps JavaScript SDK for web map; Places for address search; Routes API for estimates/navigation links; server-side key for route calculations, browser key restricted by origin/API
- Consent-based location sharing only during an active job; driver location heartbeat, freshness indicators, customer-visible status, and retention limits

### Release 2 — Rides and food

- Ride quote/request, driver matching, active trip lifecycle, emergency/support affordances
- Restaurant onboarding, menu/catalog, availability, order prep lifecycle, delivery dispatch
- Driver/partner app expands to eligible job types; dispatch respects service and vehicle eligibility
- Payment capture/refunds, receipts, rating and notification flows

### Release 3 — Vehicle transport and business shipments

- Vehicle condition capture, pickup/delivery photos, OTP and signature proof
- Business portal, API/bulk upload, shipment reports, invoices, staff roles
- Advanced dispatch, multi-stop routes, incentives, analytics, and multi-city configuration

## Proposed technical boundaries

- **Customer and partner clients:** responsive web/PWA first; native clients consume the same versioned HTTPS API later.
- **API:** modular service boundaries for identity, catalog, quote/booking, dispatch, location, payments, notification, support, and audit. Never trust price, role, or status transitions supplied by a client.
- **Data:** PostgreSQL as the system of record. Core entities: users/roles, partner profiles/documents, service-specific bookings, addresses, quotes, payments/refunds, assignments, tracking events, location samples, delivery proofs, notifications, tickets, and audit events.
- **Live updates:** authenticated WebSocket or managed realtime channel for active jobs; periodic driver location heartbeat over HTTPS as reconnect fallback. Store location only for the active operational need and apply explicit retention.
- **Maps:** Google Maps Platform behind a provider adapter. Keep browser-restricted and server-restricted keys separate; do not ship unrestricted secrets. Google Maps supplies mapping/routing, while our dispatch backend owns assignment and our location API owns live partner position.
- **Security/operations:** OTP rate limits, role and object-level authorization, encrypted transport/storage, secret manager, payment tokenization/provider-hosted collection, idempotency, audit logging, abuse controls, backups, alerting, and incident runbooks.

## Production gates before accepting real orders

1. Choose launch city/country, legal entity, service availability, pricing and cancellation policies.
2. Provide Google Maps Platform billing/project, enabled APIs, restricted client key, and server key.
3. Choose OTP/SMS, payment, push/email, hosting, and database providers; configure production credentials through a secret manager.
4. Implement and review backend authentication, authorization, transactional booking/dispatch, refunds, privacy/retention, and operational recovery.
5. Test real devices, accessibility, poor-network behavior, payment webhooks, location freshness, driver safety workflows, backups, monitoring, and staged rollout.

## Implementation status

Release 0 and the first shared backend slice are implemented: persistent accounts/session authentication, customer/business service requests, partner approvals, atomic dispatch acceptance, operations reassignment, status history, explicit partner location sharing, authenticated live updates, Google navigation links, optional embedded Google Maps tracking, support tickets/resolution, retry-safe booking submission, and container deployment configuration.

The launch country is India; customer and partner apps target Android and iPhone. The first launch city remains to be selected. `mobile/` contains Expo/React Native source with secure sessions, customer/partner booking workflows and a shared login with account type selected at sign-up, Google navigation, and active-job background location code. Native device validation, signing, and store release remain unfinished.

All five services currently use the shared request flow. Service-specific food menus, automatic ride/package quotes, checkout/refunds, OTP/KYC/proof of delivery, notifications, and complete merchant operations remain unfinished. Provider credentials and deployment have not been configured, and browser visual/device QA remains unverified. The project should not accept production orders until the launch gates and remaining modules are completed.

