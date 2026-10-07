# 🚀 DeliveryOS — All-in-One Delivery & Mobility Super App

A production-grade, multi-tenant delivery and mobility platform built as a monorepo.

## Services
| Service | Tech | Description |
|---|---|---|
| Customer Mobile | React Native + Expo | Order food, book rides, send packages |
| Driver Mobile | React Native + Expo | Receive and complete jobs |
| Customer Web | Next.js 14 | Web ordering & tracking |
| Admin Dashboard | Next.js 14 | Full platform management |
| Business Portal | Next.js 14 | B2B shipment management |
| Backend API | NestJS + PostgreSQL | Core business logic |
| Worker | NestJS + BullMQ | Background jobs & dispatch |

## Tech Stack
- **Runtime:** Node.js 20 LTS
- **Language:** TypeScript (strict)
- **Database:** PostgreSQL 16 + Prisma ORM
- **Cache/Queue:** Redis 7 + BullMQ
- **Real-time:** Socket.IO
- **Maps:** Google Maps (routing) + Mapbox (display)
- **Payments:** Razorpay + Stripe (multi-region)
- **SMS OTP:** Twilio
- **Push:** Firebase Cloud Messaging
- **Storage:** Cloudflare R2
- **Auth:** OTP + JWT (access + refresh tokens)

## Getting Started

```bash
# Install dependencies
pnpm install

# Start infrastructure (Postgres, Redis)
docker-compose up -d postgres redis

# Run database migrations
pnpm db:migrate

# Seed development data
pnpm db:seed

# Start all services
pnpm dev
```

## Project Structure

```
delivery-super-app/
├── apps/
│   ├── customer-mobile/    # React Native + Expo
│   ├── driver-mobile/      # React Native + Expo
│   ├── customer-web/       # Next.js 14
│   ├── admin-web/          # Next.js 14
│   └── business-web/       # Next.js 14
├── packages/
│   ├── ui/                 # Shared UI components
│   ├── types/              # Shared TypeScript types
│   ├── api-client/         # Auto-generated API client
│   ├── validation/         # Zod schemas
│   ├── constants/          # Shared constants
│   └── utils/              # Shared utilities
├── services/
│   ├── api/                # NestJS backend
│   └── worker/             # BullMQ worker
└── database/               # Prisma schema + migrations
```

## Architecture

```
CUSTOMER / DRIVER / BUSINESS
         │
    API GATEWAY (NestJS)
         │
  ┌──────┼──────────┐
  │      │          │
ORDERS  RIDES   PACKAGES
  │      │          │
  └──────┼──────────┘
         │
      DISPATCH
         │
   DRIVER / PARTNER
         │
      TRACKING
         │
      PAYMENT
         │
      RATING
```

## License
MIT

# Delivery
