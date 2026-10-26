-- Staff accounts that can sign in to the admin dashboard
CREATE TABLE users (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          text        NOT NULL,
  email         text        NOT NULL,
  password_hash text        NOT NULL,
  role          text        NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- Cars for sale
CREATE TABLE vehicles (
  id           integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  make         text          NOT NULL,
  model        text          NOT NULL,
  year         integer       NOT NULL CHECK (year BETWEEN 1950 AND 2100),
  price        numeric(12,2) NOT NULL CHECK (price >= 0),
  mileage      integer       NOT NULL DEFAULT 0 CHECK (mileage >= 0),
  fuel_type    text          NOT NULL CHECK (fuel_type IN ('petrol', 'diesel', 'hybrid', 'electric')),
  transmission text          NOT NULL CHECK (transmission IN ('automatic', 'manual')),
  body_type    text          NOT NULL CHECK (body_type IN ('sedan', 'suv', 'hatchback', 'coupe', 'pickup', 'van', 'convertible', 'wagon')),
  color        text,
  engine       text,
  description  text,
  images       text[]        NOT NULL DEFAULT '{}',
  status       text          NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'sold')),
  featured     boolean       NOT NULL DEFAULT false,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX vehicles_status_idx ON vehicles (status);
CREATE INDEX vehicles_make_idx   ON vehicles (lower(make));
CREATE INDEX vehicles_price_idx  ON vehicles (price);

-- Enquiries, test-drive bookings and general contact messages
CREATE TABLE leads (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_id     integer     REFERENCES vehicles (id) ON DELETE SET NULL,
  type           text        NOT NULL CHECK (type IN ('enquiry', 'test_drive', 'contact')),
  name           text        NOT NULL,
  email          text        NOT NULL,
  phone          text,
  message        text,
  preferred_date date,
  status         text        NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'closed')),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leads_status_idx  ON leads (status);
CREATE INDEX leads_created_idx ON leads (created_at DESC);

-- Car finance applications
CREATE TABLE finance_applications (
  id                integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_id        integer       REFERENCES vehicles (id) ON DELETE SET NULL,
  name              text          NOT NULL,
  email             text          NOT NULL,
  phone             text          NOT NULL,
  employment_status text          NOT NULL CHECK (employment_status IN ('employed', 'self_employed', 'retired', 'student', 'unemployed')),
  monthly_income    numeric(12,2) NOT NULL CHECK (monthly_income >= 0),
  vehicle_price     numeric(12,2) NOT NULL CHECK (vehicle_price > 0),
  deposit           numeric(12,2) NOT NULL CHECK (deposit >= 0),
  term_months       integer       NOT NULL CHECK (term_months BETWEEN 12 AND 84),
  apr               numeric(5,2)  NOT NULL CHECK (apr >= 0),
  monthly_payment   numeric(12,2) NOT NULL,
  status            text          NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  notes             text,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  CHECK (deposit < vehicle_price)
);
CREATE INDEX finance_status_idx ON finance_applications (status);

-- Keep updated_at current on every UPDATE
CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vehicles_updated_at BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER leads_updated_at BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER finance_updated_at BEFORE UPDATE ON finance_applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Supabase exposes tables in the public schema through its auto-generated REST API.
-- Enabling row-level security with no policies blocks that API entirely; this server
-- connects as the table owner, which RLS does not apply to.
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads                ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_applications ENABLE ROW LEVEL SECURITY;
