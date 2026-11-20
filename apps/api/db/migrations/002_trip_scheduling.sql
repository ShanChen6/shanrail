CREATE TABLE coach_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  places jsonb NOT NULL CHECK (jsonb_typeof(places) = 'array' AND jsonb_array_length(places) > 0)
);

CREATE TABLE trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  route_id uuid NOT NULL REFERENCES routes(id),
  departure_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ON_SALE')),
  published_at timestamptz,
  UNIQUE (code, departure_at),
  CHECK ((status = 'ON_SALE') = (published_at IS NOT NULL))
);

CREATE TABLE trip_stops (
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  station_id uuid NOT NULL REFERENCES stations(id),
  stop_order integer NOT NULL CHECK (stop_order >= 0),
  distance_km integer NOT NULL CHECK (distance_km >= 0),
  arrival_at timestamptz,
  departure_at timestamptz,
  PRIMARY KEY (trip_id, stop_order),
  UNIQUE (trip_id, station_id),
  CHECK (arrival_at IS NOT NULL OR departure_at IS NOT NULL),
  CHECK (arrival_at IS NULL OR departure_at IS NULL OR arrival_at <= departure_at)
);

CREATE TABLE trip_coaches (
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  coach_number integer NOT NULL CHECK (coach_number > 0),
  template_id uuid NOT NULL REFERENCES coach_templates(id),
  name text NOT NULL,
  places jsonb NOT NULL CHECK (jsonb_typeof(places) = 'array' AND jsonb_array_length(places) > 0),
  PRIMARY KEY (trip_id, coach_number)
);
