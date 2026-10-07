CREATE TABLE users (
  id uuid PRIMARY KEY, name varchar(100) NOT NULL, email varchar(200) NOT NULL UNIQUE,
  password text NOT NULL, role text NOT NULL CHECK(role IN ('customer','partner','business','restaurant','admin')),
  approved boolean NOT NULL DEFAULT false, created timestamptz NOT NULL DEFAULT now(),
  CHECK(email = lower(email))
);
CREATE TABLE sessions (
  token char(64) PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), expires bigint NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires);
CREATE TABLE orders (
  id text PRIMARY KEY, customer_id uuid NOT NULL REFERENCES users(id), partner_id uuid REFERENCES users(id),
  service text NOT NULL CHECK(service IN ('food','ride','package','vehicle','business')),
  pickup varchar(500) NOT NULL, destination varchar(500) NOT NULL, details jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','assigned','arriving','picked_up','in_transit','completed','cancelled')),
  created timestamptz NOT NULL DEFAULT now(), updated timestamptz NOT NULL DEFAULT now(),
  CHECK(status NOT IN ('assigned','arriving','picked_up','in_transit','completed') OR partner_id IS NOT NULL)
);
CREATE UNIQUE INDEX one_active_job_per_partner ON orders(partner_id)
  WHERE status IN ('assigned','arriving','picked_up','in_transit');
CREATE INDEX customer_orders ON orders(customer_id, created DESC);
CREATE INDEX pending_dispatch ON orders(service,created) WHERE status='requested';
CREATE TABLE events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, order_id text NOT NULL REFERENCES orders(id),
  actor_id uuid NOT NULL REFERENCES users(id), status text NOT NULL, created timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events ON events(order_id, id);
CREATE TABLE locations (
  order_id text PRIMARY KEY REFERENCES orders(id), lat double precision NOT NULL CHECK(lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK(lng BETWEEN -180 AND 180), accuracy double precision NOT NULL CHECK(accuracy BETWEEN 0 AND 100000),
  updated timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tickets (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), subject varchar(100) NOT NULL,
  message varchar(2000) NOT NULL, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  created timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor uuid NOT NULL REFERENCES users(id),
  action text NOT NULL, target text NOT NULL, created timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE requests (
  user_id uuid NOT NULL REFERENCES users(id), request_id varchar(100) NOT NULL,
  order_id text NOT NULL REFERENCES orders(id), PRIMARY KEY(user_id,request_id)
);
CREATE TABLE driver_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id), online boolean NOT NULL DEFAULT false,
  vehicle_type text CHECK(vehicle_type IN ('bicycle','motorcycle','car','van','truck')),
  eligible_services text[] NOT NULL DEFAULT '{}', last_seen timestamptz,
  CHECK(eligible_services <@ ARRAY['food','ride','package','vehicle','business']::text[])
);
CREATE TABLE payments (
  id uuid PRIMARY KEY, order_id text NOT NULL REFERENCES orders(id), provider text NOT NULL,
  provider_order_id text NOT NULL UNIQUE, provider_payment_id text UNIQUE,
  amount_paise bigint NOT NULL CHECK(amount_paise > 0), currency char(3) NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
  status text NOT NULL CHECK(status IN ('created','authorized','captured','failed','refunded')),
  created timestamptz NOT NULL DEFAULT now(), updated timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE webhook_receipts (
  provider text NOT NULL, event_id text NOT NULL, received timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(provider,event_id)
);
CREATE TABLE outbox (
  id uuid PRIMARY KEY, topic text NOT NULL, aggregate_id text NOT NULL, payload jsonb NOT NULL,
  created timestamptz NOT NULL DEFAULT now(), published timestamptz
);
CREATE INDEX unpublished_outbox ON outbox(created) WHERE published IS NULL;
