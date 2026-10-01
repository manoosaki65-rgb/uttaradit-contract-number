CREATE TABLE contract_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_no text NOT NULL UNIQUE,
  fiscal_year integer NOT NULL,
  contract_date text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  vendor text NOT NULL DEFAULT '',
  amount numeric,
  inventory_no text NOT NULL DEFAULT '',
  buyer text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
)