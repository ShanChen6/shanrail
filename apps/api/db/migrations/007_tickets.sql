CREATE TABLE tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES checkout_orders(id),
  passenger_index integer NOT NULL CHECK (passenger_index > 0),
  issued_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, passenger_index)
);

INSERT INTO tickets (order_id, passenger_index)
SELECT o.id, p.position::integer
FROM checkout_orders o
CROSS JOIN LATERAL jsonb_array_elements(o.passengers) WITH ORDINALITY p(passenger, position)
WHERE o.status = 'PAID';
