DROP VIEW v_sub_day;
CREATE VIEW v_sub_day AS
  SELECT day, firm, firm AS subcontractor, team, label AS project, binding, SUM(customer_cents) / 100.0 AS revenue_eur, SUM(cost_cents) / 100.0 AS cost_eur, MAX(heads) AS heads, ROUND(SUM(hours_minutes) / 60.0, 1) AS hours FROM fact_sub GROUP BY day, firm, team, label, binding;
