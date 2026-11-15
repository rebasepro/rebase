-- PROOF for the explainer "Your view is a side door around row-level
-- security" (src/explainers/01-view-side-door.tsx, VOICEOVER-EXPLAINERS.md).
--
-- Every statement and result the film shows is printed by this file. Run it
-- with scripts/proof-view-side-door.sh, which starts a throwaway cluster,
-- runs this as its superuser with `psql -X -e` (statements echoed), compares
-- the output with view-side-door.expected, and tears the cluster down.
--
-- Some statements fail ON PURPOSE (the materialized-view section): those
-- errors are claims too, and the expected file holds them.

\pset footer on
\set VERBOSITY default

-- The roles: `app` runs the migrations and owns everything it creates, as
-- it does in most projects; alice and bob are signed-in users.
CREATE ROLE app LOGIN;
CREATE ROLE alice LOGIN;
CREATE ROLE bob LOGIN;
GRANT CREATE ON SCHEMA public TO app;

\echo '== 1. The table, guarded by a policy'
SET ROLE app;
CREATE TABLE orders (id int PRIMARY KEY, customer text NOT NULL, total numeric NOT NULL);
INSERT INTO orders VALUES (1, 'alice', 18.50), (2, 'bob', 64.00), (3, 'carol', 120.00);
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_orders ON orders FOR SELECT USING (customer = current_user);
GRANT SELECT ON orders TO alice, bob;
RESET ROLE;

SET ROLE alice;
SELECT * FROM orders;
RESET ROLE;

\echo '== 2. A view over it, from the same migration role'
SET ROLE app;
CREATE VIEW order_list AS SELECT id, customer, total FROM orders;
GRANT SELECT ON order_list TO alice, bob;
RESET ROLE;

SET ROLE alice;
SELECT * FROM order_list;
RESET ROLE;

\echo '== 3. Why: the view reads as its owner, and the table owner skips RLS'
SELECT relname, relowner::regrole AS owner
FROM pg_class
WHERE relname IN ('orders', 'order_list')
ORDER BY 1 DESC;

SET ROLE alice;
SELECT (SELECT count(*) FROM orders) AS via_table,
       (SELECT count(*) FROM order_list) AS via_view;
RESET ROLE;

\echo '== 3b. "unless you force it": FORCE puts the owner under the policy too'
SET ROLE app;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;
RESET ROLE;
SET ROLE alice;
SELECT * FROM order_list;
RESET ROLE;
SET ROLE app;
ALTER TABLE orders NO FORCE ROW LEVEL SECURITY;
RESET ROLE;

\echo '== 4. The fix (Postgres 15+): the view checks as whoever queries it'
SET ROLE app;
ALTER VIEW order_list SET (security_invoker = true);
RESET ROLE;

SET ROLE alice;
SELECT * FROM order_list;
RESET ROLE;

\echo '== 4b. The same switch at creation'
SET ROLE app;
CREATE VIEW my_orders
  WITH (security_invoker = true)
  AS SELECT id, customer, total
  FROM orders;
GRANT SELECT ON my_orders TO alice, bob;
RESET ROLE;

SET ROLE bob;
SELECT * FROM order_list;
RESET ROLE;
SET ROLE alice;
SELECT * FROM my_orders;
RESET ROLE;

\echo '== 5. A materialized view has the same hole, and no switch'
SET ROLE app;
CREATE MATERIALIZED VIEW order_totals AS SELECT customer, sum(total) AS spent FROM orders GROUP BY customer ORDER BY customer;
GRANT SELECT ON order_totals TO alice;
RESET ROLE;

SET ROLE alice;
SELECT * FROM order_totals;
RESET ROLE;

SET ROLE app;
ALTER MATERIALIZED VIEW order_totals SET (security_invoker = true);
ALTER TABLE order_totals ENABLE ROW LEVEL SECURITY;
RESET ROLE;

\echo '== 6. Not every view is a side door: an owner that RLS applies to'
-- `reporter` does not own `orders`, so the policy applies to it, and a view
-- it owns does not widen anything. The door opens when the owner bypasses
-- RLS: the table's owner (unless FORCE ROW LEVEL SECURITY), a superuser, or
-- a role with BYPASSRLS. That is why the script says "usually".
CREATE ROLE reporter;
GRANT CREATE ON SCHEMA public TO reporter;
SET ROLE app;
GRANT SELECT ON orders TO reporter;
RESET ROLE;
SET ROLE reporter;
CREATE VIEW reporter_list AS SELECT id, customer FROM orders;
GRANT SELECT ON reporter_list TO alice;
RESET ROLE;
SET ROLE alice;
SELECT * FROM reporter_list;
RESET ROLE;

\echo '== 7. The check: views and materialized views without security_invoker over RLS tables'
-- reporter_list shows up too: the check is deliberately broad (it lists every
-- definer-rights view over an RLS table, side door or not); drop it so the
-- film's output is the one-finding case.
DROP VIEW reporter_list;
SELECT DISTINCT v.oid::regclass AS view,
       t.oid::regclass AS rls_table
FROM pg_class v
JOIN pg_rewrite r ON r.ev_class = v.oid
JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass
                AND d.objid = r.oid
                AND d.refclassid = 'pg_class'::regclass
JOIN pg_class t ON t.oid = d.refobjid AND t.relrowsecurity
WHERE v.relkind IN ('v', 'm')
  AND NOT coalesce((SELECT option_value::bool
                    FROM pg_options_to_table(v.reloptions)
                    WHERE option_name = 'security_invoker'), false);

\echo '== 7b. The check catches a view set back to definer rights'
SET ROLE app;
ALTER VIEW order_list RESET (security_invoker);
RESET ROLE;
SELECT DISTINCT v.oid::regclass AS view, t.oid::regclass AS rls_table
FROM pg_class v
JOIN pg_rewrite r ON r.ev_class = v.oid
JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass AND d.objid = r.oid
                AND d.refclassid = 'pg_class'::regclass
JOIN pg_class t ON t.oid = d.refobjid AND t.relrowsecurity
WHERE v.relkind IN ('v', 'm')
  AND NOT coalesce((SELECT option_value::bool FROM pg_options_to_table(v.reloptions)
                    WHERE option_name = 'security_invoker'), false)
ORDER BY 1;
