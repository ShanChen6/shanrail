CREATE TABLE checkout_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_id uuid NOT NULL UNIQUE,
  trip_id uuid NOT NULL REFERENCES trips(id),
  expires_at timestamptz NOT NULL,
  passengers jsonb NOT NULL,
  segment_count integer NOT NULL CHECK (segment_count > 0),
  amount_vnd bigint NOT NULL CHECK (amount_vnd > 0),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PAID', 'FAILED', 'REVIEW')),
  payment_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid()
);
