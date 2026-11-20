CREATE TABLE trip_place_segments (
  trip_id uuid NOT NULL,
  coach_number integer NOT NULL,
  place_label text NOT NULL CHECK (btrim(place_label) <> ''),
  segment_order integer NOT NULL,
  state text NOT NULL CHECK (state IN ('HELD', 'SOLD')),
  expires_at timestamptz,
  PRIMARY KEY (trip_id, coach_number, place_label, segment_order),
  FOREIGN KEY (trip_id, coach_number) REFERENCES trip_coaches(trip_id, coach_number) ON DELETE CASCADE,
  FOREIGN KEY (trip_id, segment_order) REFERENCES trip_stops(trip_id, stop_order) ON DELETE CASCADE,
  CHECK ((state = 'HELD') = (expires_at IS NOT NULL))
);
