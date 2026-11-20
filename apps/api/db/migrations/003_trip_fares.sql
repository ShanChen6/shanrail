ALTER TABLE trips
  ADD COLUMN seat_vnd_per_km integer NOT NULL DEFAULT 900 CHECK (seat_vnd_per_km BETWEEN 1 AND 10000),
  ADD COLUMN berth_vnd_per_km integer NOT NULL DEFAULT 1500 CHECK (berth_vnd_per_km BETWEEN 1 AND 10000);

CREATE INDEX trip_stops_boarding_idx ON trip_stops (station_id, departure_at)
WHERE departure_at IS NOT NULL;
