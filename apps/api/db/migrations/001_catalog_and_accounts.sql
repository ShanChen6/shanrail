CREATE TYPE user_role AS ENUM ('CUSTOMER', 'ADMIN', 'INSPECTOR');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email <> '' AND email = lower(btrim(email))),
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  password_hash text NOT NULL,
  role user_role NOT NULL DEFAULT 'CUSTOMER',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  city text NOT NULL
);

CREATE TABLE routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE route_stops (
  route_id uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  station_id uuid NOT NULL REFERENCES stations(id),
  stop_order integer NOT NULL CHECK (stop_order >= 0),
  distance_km integer NOT NULL CHECK (distance_km >= 0),
  PRIMARY KEY (route_id, stop_order),
  UNIQUE (route_id, station_id)
);
