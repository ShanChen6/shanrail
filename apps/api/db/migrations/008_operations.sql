CREATE TABLE ticket_inspections (
  ticket_id uuid PRIMARY KEY REFERENCES tickets(id),
  inspector_id uuid NOT NULL REFERENCES users(id),
  inspected_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE checkout_orders
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN reviewed_by uuid REFERENCES users(id),
  ADD COLUMN review_note text,
  ADD CONSTRAINT checkout_order_review_fields CHECK (
    (reviewed_at IS NULL AND reviewed_by IS NULL AND review_note IS NULL)
    OR (status = 'REVIEW' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND review_note IS NOT NULL)
  );
