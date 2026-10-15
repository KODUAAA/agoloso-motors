-- "Find me a car" requests: cars a customer wants that aren't in stock,
-- which the dealership sources for them
CREATE TABLE sourcing_requests (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  make          text          NOT NULL,
  model         text          NOT NULL,
  year_min      integer       CHECK (year_min BETWEEN 1950 AND 2100),
  year_max      integer       CHECK (year_max BETWEEN 1950 AND 2100),
  trim          text,
  color         text,
  max_mileage   integer       CHECK (max_mileage >= 0),
  budget        numeric(12,2) NOT NULL CHECK (budget > 0),
  timeframe     text          NOT NULL CHECK (timeframe IN ('asap', 'within_1_month', 'within_3_months', 'flexible')),
  name          text          NOT NULL,
  email         text          NOT NULL,
  phone         text          NOT NULL,
  message       text,
  status        text          NOT NULL DEFAULT 'new'
                CHECK (status IN ('new', 'searching', 'quote_sent', 'deposit_paid', 'shipping', 'delivered', 'cancelled')),
  quote_amount  numeric(12,2) CHECK (quote_amount >= 0),
  notes         text,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  CHECK (year_min IS NULL OR year_max IS NULL OR year_min <= year_max)
);
CREATE INDEX sourcing_status_idx  ON sourcing_requests (status);
CREATE INDEX sourcing_created_idx ON sourcing_requests (created_at DESC);

CREATE TRIGGER sourcing_updated_at BEFORE UPDATE ON sourcing_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Block Supabase's auto-generated public API, as for the other tables
ALTER TABLE sourcing_requests ENABLE ROW LEVEL SECURITY;
