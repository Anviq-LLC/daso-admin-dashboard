CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE roles (email TEXT PRIMARY KEY, role TEXT NOT NULL CHECK (role IN ('gf','buchhaltung','viewer')), name TEXT NOT NULL DEFAULT '', sensitive INTEGER NOT NULL DEFAULT 0);
CREATE TABLE audit (id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
CREATE INDEX audit_at ON audit(at);

-- every changed value of a past day is kept so recalculations stay traceable
CREATE TABLE change_log (
  id TEXT PRIMARY KEY, at TEXT NOT NULL, month TEXT NOT NULL, day TEXT NOT NULL,
  scope TEXT NOT NULL, report_id TEXT NOT NULL DEFAULT '', before_cents INTEGER, after_cents INTEGER, reason TEXT NOT NULL
);
CREATE INDEX change_month ON change_log(month);

CREATE TABLE dim_resource (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'employee', archived INTEGER NOT NULL DEFAULT 0);

-- binding = approved by the customer; 0 means pipeline only. estimated = multi-day split by rule.
CREATE TABLE fact_emp (
  month TEXT NOT NULL, day TEXT NOT NULL, resource_id TEXT NOT NULL, name TEXT NOT NULL, project_id TEXT NOT NULL, label TEXT NOT NULL,
  report_id TEXT NOT NULL, customer_cents INTEGER NOT NULL, employee_cents INTEGER NOT NULL, binding INTEGER NOT NULL, estimated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX fact_emp_month ON fact_emp(month, day);
CREATE TABLE fact_sub (
  month TEXT NOT NULL, day TEXT NOT NULL, project_id TEXT NOT NULL, label TEXT NOT NULL, firm TEXT NOT NULL, team TEXT NOT NULL,
  report_id TEXT NOT NULL, customer_cents INTEGER NOT NULL, cost_cents INTEGER, heads INTEGER, hours_minutes INTEGER, binding INTEGER NOT NULL, estimated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX fact_sub_month ON fact_sub(month, day);
CREATE TABLE fact_hours (month TEXT NOT NULL, day TEXT NOT NULL, resource_id TEXT NOT NULL, project_id TEXT NOT NULL, minutes INTEGER NOT NULL, travel INTEGER NOT NULL DEFAULT 0, open_shift INTEGER NOT NULL DEFAULT 0);
CREATE INDEX fact_hours_month ON fact_hours(month, day);
CREATE TABLE fact_absence (month TEXT NOT NULL, day TEXT NOT NULL, resource_id TEXT NOT NULL, kind TEXT NOT NULL, review INTEGER NOT NULL DEFAULT 0);
CREATE INDEX fact_absence_month ON fact_absence(month);
CREATE TABLE ingest_warning (month TEXT NOT NULL, text TEXT NOT NULL);

CREATE TABLE sub_alias (alias TEXT PRIMARY KEY, canonical TEXT NOT NULL);

CREATE TABLE cost_type (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, monthly_cents INTEGER NOT NULL,
  valid_from TEXT NOT NULL, valid_to TEXT, doc_url TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  replaces TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE cost_entry (
  id TEXT PRIMARY KEY, day TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('sub','alex','other')),
  project_id TEXT NOT NULL DEFAULT '', firm TEXT NOT NULL DEFAULT '', subcategory TEXT NOT NULL DEFAULT '',
  cents INTEGER NOT NULL, doc_url TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX cost_entry_day ON cost_entry(day);
CREATE TABLE wage (resource_id TEXT NOT NULL, valid_from TEXT NOT NULL, hourly_cents INTEGER NOT NULL, PRIMARY KEY (resource_id, valid_from));

CREATE TABLE bwa_import (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('bwa','susa')), period TEXT NOT NULL, version INTEGER NOT NULL,
  file_key TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL, source_format TEXT NOT NULL, mapping_version INTEGER NOT NULL,
  imported_by TEXT NOT NULL, imported_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'review', unmapped INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX bwa_period ON bwa_import(period, kind, version);
CREATE TABLE bwa_line (import_id TEXT NOT NULL, account TEXT NOT NULL, label TEXT NOT NULL, cents INTEGER NOT NULL, bucket TEXT NOT NULL DEFAULT '');
CREATE INDEX bwa_line_import ON bwa_line(import_id);
CREATE TABLE account_mapping (version INTEGER NOT NULL, pattern TEXT NOT NULL, bucket TEXT NOT NULL, PRIMARY KEY (version, pattern));

-- read-only views for the data API: no wages, no names of workers, no document links
CREATE VIEW v_revenue_day AS
  SELECT day, ROUND(SUM(CASE WHEN binding = 1 THEN customer_cents ELSE 0 END) / 100.0, 2) AS own_revenue_eur FROM fact_emp GROUP BY day;
CREATE VIEW v_sub_day AS
  SELECT day, firm, label AS project, binding, SUM(customer_cents) / 100.0 AS revenue_eur, SUM(cost_cents) / 100.0 AS cost_eur, MAX(heads) AS heads FROM fact_sub GROUP BY day, firm, label, binding;
CREATE VIEW v_project_day AS
  SELECT day, label AS project, 'own' AS source, binding, SUM(customer_cents) / 100.0 AS revenue_eur FROM fact_emp GROUP BY day, label, binding
  UNION ALL SELECT day, label, 'sub', binding, SUM(customer_cents) / 100.0 FROM fact_sub GROUP BY day, label, binding;
