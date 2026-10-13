-- LGU Bambang: Travel Order, Leave (CS Form No. 6) and Personnel Locator/Pass Slip
-- PostgreSQL. Lines marked VERIFY are assumptions to confirm with the HRMO.

-- ---------- People, offices, officials, accounts ----------
CREATE TABLE offices (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  head_employee_id int                      -- FK added below
);

CREATE TABLE employees (
  id serial PRIMARY KEY,
  last_name text NOT NULL, first_name text NOT NULL, middle_name text,
  position text NOT NULL,                   -- current designation
  office_id int NOT NULL REFERENCES offices(id),
  employment_status text NOT NULL
    CHECK (employment_status IN ('elective','permanent','casual','coterminous','job_order','contract_of_service')),
  monthly_salary numeric(12,2),             -- shown on CS Form 6, box 5
  active boolean NOT NULL DEFAULT true
);
ALTER TABLE offices ADD FOREIGN KEY (head_employee_id) REFERENCES employees(id);

-- Signatories printed on forms. Kept as data because officials change after elections.
CREATE TABLE officials (
  id serial PRIMARY KEY,
  employee_id int REFERENCES employees(id),
  printed_name text NOT NULL,
  title text NOT NULL,                      -- Municipal Mayor, Vice Mayor, Municipal Administrator, HRMO III ...
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE users (
  id serial PRIMARY KEY,
  employee_id int NOT NULL UNIQUE REFERENCES employees(id),
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('employee','hrmo','dept_head','official','admin'))
);

-- ---------- Numbering and approval flow (shared by all three forms) ----------
-- Travel order series. VERIFY: T.O. No. 34 (SB format) and No. 292 (executive) were dated one day apart.
CREATE TABLE doc_series (
  doc_type text NOT NULL CHECK (doc_type IN ('travel_order','leave','pass_slip')),
  series   text NOT NULL,                   -- 'executive', 'sb', or 'default'
  year     int  NOT NULL,
  last_no  int  NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_type, series, year)
);

-- Approval chain per form type and version, stored as data so it can change without new code
CREATE TABLE approval_steps (
  id serial PRIMARY KEY,
  doc_type text NOT NULL CHECK (doc_type IN ('travel_order','leave','pass_slip')),
  version  text NOT NULL DEFAULT 'default',  -- travel orders: 'executive' or 'sb'
  step_order int NOT NULL,
  action text NOT NULL CHECK (action IN ('record','recommend','approve','validate')),
  official_title text,                       -- who acts, e.g. 'Vice Mayor'; NULL = by office head
  UNIQUE (doc_type, version, step_order)
);

CREATE TABLE request_approvals (
  id bigserial PRIMARY KEY,
  doc_type text NOT NULL, doc_id int NOT NULL,
  step_order int NOT NULL,
  action text NOT NULL,
  assigned_official_id int REFERENCES officials(id),
  acted_by int REFERENCES users(id),
  decision text CHECK (decision IN ('approved','disapproved','returned')),
  remarks text,
  acted_at timestamptz
);

CREATE TABLE status_log (                     -- append-only audit trail
  id bigserial PRIMARY KEY,
  doc_type text NOT NULL, doc_id int NOT NULL,
  status text NOT NULL,
  changed_by int NOT NULL REFERENCES users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  remarks text
);

CREATE TABLE attachments (
  id serial PRIMARY KEY,
  doc_type text NOT NULL, doc_id int NOT NULL,
  kind text NOT NULL, file_path text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Travel order ----------
CREATE TABLE travel_orders (
  id serial PRIMARY KEY,
  version text NOT NULL CHECK (version IN ('executive','sb')),   -- VERIFY: two formats seen
  to_number int,                              -- assigned at 'recorded'
  to_year int NOT NULL,                       -- printed as "s. 2026"
  order_date date NOT NULL DEFAULT current_date,
  filed_by int NOT NULL REFERENCES employees(id),
  destination text NOT NULL,
  purpose text NOT NULL,
  date_from date NOT NULL, date_to date NOT NULL,
  expense_statement text NOT NULL DEFAULT
    'Expenses incurred relative hereto shall be charge against our local fund subject to usual accounting and auditing procedures.',
  recommender_id int REFERENCES officials(id),   -- Vice Mayor on the SB format
  approver_id int REFERENCES officials(id),      -- printed signatory
  signed_by_id int REFERENCES officials(id),     -- VERIFY: Administrator signed over the Mayor's name on No. 292
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','filed','recorded','recommended','approved','disapproved','released','completed','cancelled')),
  disapproval_reason text,
  CHECK (date_to >= date_from),
  UNIQUE (version, to_year, to_number)        -- VERIFY: separate numbering per version
);

CREATE TABLE travel_order_travelers (
  travel_order_id int NOT NULL REFERENCES travel_orders(id) ON DELETE CASCADE,
  employee_id int NOT NULL REFERENCES employees(id),
  position_printed text NOT NULL,              -- position at the time, as shown on the order
  sort_order int NOT NULL DEFAULT 0,
  PRIMARY KEY (travel_order_id, employee_id)
);

-- ---------- Leave: CS Form No. 6 (Revised 2020) ----------
CREATE TABLE leave_applications (
  id serial PRIMARY KEY,
  employee_id int NOT NULL REFERENCES employees(id),
  filing_date date NOT NULL DEFAULT current_date,         -- box 3
  position_printed text NOT NULL, salary_printed numeric(12,2),  -- boxes 4, 5
  leave_type text NOT NULL CHECK (leave_type IN (          -- box 6.A
    'vacation','mandatory_forced','sick','maternity','paternity','special_privilege','solo_parent',
    'study','vawc_10day','rehabilitation','special_women','special_emergency','adoption','other')),
  leave_type_other text,
  vacation_location text CHECK (vacation_location IN ('within_ph','abroad')),   -- box 6.B
  vacation_specify text,
  sick_setting text CHECK (sick_setting IN ('hospital','outpatient')),
  illness text,                                  -- sick leave or special leave for women
  study_purpose text CHECK (study_purpose IN ('masters_completion','bar_board_review')),
  other_purpose text CHECK (other_purpose IN ('monetization','terminal_leave')),
  working_days numeric(5,1) NOT NULL,            -- box 6.C
  date_from date NOT NULL, date_to date NOT NULL,   -- inclusive dates
  commutation_requested boolean NOT NULL DEFAULT false,  -- box 6.D
  -- 7.A certification of leave credits (snapshot at certification)
  credits_as_of date,
  vl_earned numeric(7,3), vl_less numeric(7,3), vl_balance numeric(7,3),
  sl_earned numeric(7,3), sl_less numeric(7,3), sl_balance numeric(7,3),
  -- 7.B to 7.D
  recommendation text CHECK (recommendation IN ('approval','disapproval')),
  recommendation_reason text,
  approved_days_with_pay numeric(5,1), approved_days_without_pay numeric(5,1),
  approved_others numeric(5,1), approved_others_specify text,
  disapproved_due_to text,
  certifier_id int REFERENCES officials(id), recommender_id int REFERENCES officials(id), approver_id int REFERENCES officials(id),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','filed','certified','recommended','approved','disapproved','cancelled')),
  CHECK (date_to >= date_from)
);

CREATE TABLE leave_credits (                   -- ledger: balance = sum of earned minus used
  id bigserial PRIMARY KEY,
  employee_id int NOT NULL REFERENCES employees(id),
  kind text NOT NULL CHECK (kind IN ('vacation','sick')),
  entry_date date NOT NULL,
  earned numeric(7,3) NOT NULL DEFAULT 0,
  used numeric(7,3) NOT NULL DEFAULT 0,
  leave_application_id int REFERENCES leave_applications(id),
  remarks text
);

-- ---------- Personnel Locator / Pass Slip ----------
CREATE TABLE pass_slips (
  id serial PRIMARY KEY,
  slip_no text UNIQUE,                         -- VERIFY: form shows a pre-printed pad number (e.g. 5200)
  slip_date date NOT NULL DEFAULT current_date,
  employee_id int NOT NULL REFERENCES employees(id),
  designation_printed text NOT NULL,
  office_id int NOT NULL REFERENCES offices(id),
  departure_time time NOT NULL,
  arrival_time time,                           -- VERIFY: expected arrival at destination, or return to office?
  destination text NOT NULL,
  purpose_type text NOT NULL CHECK (purpose_type IN ('OB','Personal')),   -- official business or personal
  purpose text NOT NULL,
  recommender_id int REFERENCES officials(id),     -- Head of Office
  approver_id int REFERENCES officials(id),        -- VERIFY: Mayor, HRMO III, or both
  validated_by text, validated_at timestamptz,     -- "Validated by / Date and time" at the bottom
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','filed','recommended','approved','disapproved','validated','cancelled'))
);

-- Bottom table: the office visited certifies that the employee appeared
CREATE TABLE pass_slip_appearances (
  id serial PRIMARY KEY,
  pass_slip_id int NOT NULL REFERENCES pass_slips(id) ON DELETE CASCADE,
  printed_name text NOT NULL, position text, office text,
  appearance_date date, time_arrival time, time_departure time,
  signed boolean NOT NULL DEFAULT false        -- signature itself stays on paper
);

-- ---------- Numbering function (travel orders; pass slips use pad numbers) ----------
CREATE FUNCTION assign_travel_order_no(p_id int) RETURNS int AS $$
DECLARE v text; y int; n int;
BEGIN
  SELECT version, to_year INTO v, y FROM travel_orders WHERE id = p_id;
  INSERT INTO doc_series(doc_type, series, year) VALUES ('travel_order', v, y) ON CONFLICT DO NOTHING;
  UPDATE doc_series SET last_no = last_no + 1
    WHERE doc_type = 'travel_order' AND series = v AND year = y RETURNING last_no INTO n;
  UPDATE travel_orders SET to_number = n WHERE id = p_id AND to_number IS NULL;
  RETURN n;
END $$ LANGUAGE plpgsql;

-- ---------- Conflict check: travel dates vs approved leave of the same employee ----------
CREATE VIEW travel_leave_conflicts AS
SELECT t.id AS travel_order_id, tt.employee_id, l.id AS leave_id
FROM travel_orders t
JOIN travel_order_travelers tt ON tt.travel_order_id = t.id
JOIN leave_applications l ON l.employee_id = tt.employee_id AND l.status = 'approved'
 AND daterange(l.date_from, l.date_to, '[]') && daterange(t.date_from, t.date_to, '[]')
WHERE t.status NOT IN ('disapproved','cancelled');

CREATE INDEX ON travel_orders (status);
CREATE INDEX ON travel_orders (date_from, date_to);
CREATE INDEX ON leave_applications (employee_id, status);
CREATE INDEX ON pass_slips (employee_id, slip_date);
CREATE INDEX ON status_log (doc_type, doc_id);
CREATE INDEX ON request_approvals (doc_type, doc_id);
