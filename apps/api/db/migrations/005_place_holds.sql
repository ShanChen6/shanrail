ALTER TABLE trip_place_segments ADD COLUMN hold_id uuid;

CREATE INDEX trip_place_segments_hold_idx ON trip_place_segments (hold_id)
WHERE hold_id IS NOT NULL;
