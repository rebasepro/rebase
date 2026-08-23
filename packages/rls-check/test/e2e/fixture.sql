-- Fixture schema for the rls-check integration suite.
--
-- Every object here exists to prove one thing. Tables prefixed `vuln_` carry
-- exactly one deliberate defect and must produce the finding named in the
-- comment above them. Tables prefixed `secure_` are correct and must produce
-- NO findings at all — that half of the suite is what stops the tool from
-- becoming a machine that shouts at every table it sees.
--
-- The shape is deliberately Supabase-flavoured (an `auth` schema, `anon` and
-- `authenticated` roles), because that is what people will point this at.

-- ---------------------------------------------------------------------------
-- Platform shape: the roles an untrusted caller can reach, and auth.uid().
-- ---------------------------------------------------------------------------

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;

-- The role requests actually arrive as, which then SET ROLEs to anon or
-- authenticated. Without it, `anon` and `authenticated` would be unreachable —
-- nothing can log in as them — and every policy in the fixture would be dead.
-- Supabase's `authenticator` works exactly this way.
CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD 'authenticator-e2e';
GRANT anon TO authenticator;
GRANT authenticated TO authenticator;

-- Reachable by nobody: no LOGIN, and no login role is a member of it.
CREATE ROLE reporting_bot NOLOGIN;

CREATE SCHEMA auth;

-- `storage` makes the platform detectable as Supabase, which is the shape most
-- people will point this tool at. Both `auth` and `storage` are platform
-- schemas: they are full of grants and RLS-less tables by design, and the
-- scanner excludes them unless `--schema` asks for them by name. The table
-- below exists to prove that exclusion holds.
CREATE SCHEMA storage;
CREATE TABLE storage.objects (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket  text,
    path    text
);
GRANT SELECT ON storage.objects TO anon;

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$ SELECT coalesce(current_setting('request.jwt.claim.role', true), 'anon') $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;

-- ===========================================================================
-- SECURE OBJECTS — the negative half. Nothing below this banner may produce a
-- finding. If a check starts flagging one of these, the check is wrong.
-- ===========================================================================

CREATE TABLE public.secure_documents (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id  uuid NOT NULL,
    body      text
);
ALTER TABLE public.secure_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.secure_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY secure_documents_select ON public.secure_documents
    FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY secure_documents_insert ON public.secure_documents
    FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY secure_documents_update ON public.secure_documents
    FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY secure_documents_delete ON public.secure_documents
    FOR DELETE TO authenticated USING (owner_id = auth.uid());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.secure_documents TO authenticated;

-- Tenant scoping done right: `current_setting(..., true)` returns NULL when the
-- GUC is unset instead of raising, so an unauthenticated request gets zero rows
-- rather than a 500.
CREATE TABLE public.secure_tenanted (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  text NOT NULL,
    label      text
);
ALTER TABLE public.secure_tenanted ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.secure_tenanted FORCE ROW LEVEL SECURITY;
CREATE POLICY secure_tenanted_all ON public.secure_tenanted
    FOR ALL TO authenticated
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.secure_tenanted TO authenticated;

CREATE TABLE public.projects (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id  uuid NOT NULL,
    name      text
);
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects FORCE ROW LEVEL SECURITY;
CREATE POLICY projects_all ON public.projects
    FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;

CREATE TABLE public.people (
    id     uuid PRIMARY KEY,
    email  text
);
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.people FORCE ROW LEVEL SECURITY;
CREATE POLICY people_all ON public.people
    FOR ALL TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.people TO authenticated;

-- A junction table, protected the way a junction table should be: reads and
-- writes follow the owning endpoint, every column reference qualified.
CREATE TABLE public.secure_project_members (
    project_id  uuid NOT NULL REFERENCES public.projects (id),
    person_id   uuid NOT NULL REFERENCES public.people (id),
    PRIMARY KEY (project_id, person_id)
);
ALTER TABLE public.secure_project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.secure_project_members FORCE ROW LEVEL SECURITY;
CREATE POLICY secure_project_members_all ON public.secure_project_members
    FOR ALL TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = secure_project_members.project_id AND p.owner_id = auth.uid()
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = secure_project_members.project_id AND p.owner_id = auth.uid()
    ));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.secure_project_members TO authenticated;

-- SECURITY DEFINER done right: search_path pinned, so the function cannot be
-- hijacked by a caller who creates a shadowing object in a schema it searches.
CREATE FUNCTION public.secure_definer_fn() RETURNS integer
    LANGUAGE sql SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$ SELECT 1 $$;

-- ===========================================================================
-- VULNERABLE OBJECTS — one defect each, named by the check that must catch it.
-- ===========================================================================

-- rls-disabled: no row-level security at all, and anon can read it.
CREATE TABLE public.vuln_rls_disabled (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid,
    secret   text
);
GRANT SELECT ON public.vuln_rls_disabled TO anon, authenticated;

-- policy-always-true: RLS is on and forced, and the policy lets everyone read
-- every row anyway.
CREATE TABLE public.vuln_policy_always_true (
    id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    body  text
);
ALTER TABLE public.vuln_policy_always_true ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vuln_policy_always_true FORCE ROW LEVEL SECURITY;
CREATE POLICY vuln_policy_always_true_select ON public.vuln_policy_always_true
    FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.vuln_policy_always_true TO anon, authenticated;

-- policy-anonymous-tautology: "is anyone logged in" is not a row filter. Every
-- authenticated user reads every other user's rows.
CREATE TABLE public.vuln_anon_tautology (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid,
    body     text
);
ALTER TABLE public.vuln_anon_tautology ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vuln_anon_tautology FORCE ROW LEVEL SECURITY;
CREATE POLICY vuln_anon_tautology_select ON public.vuln_anon_tautology
    FOR SELECT TO public USING (auth.uid() IS NOT NULL);
GRANT SELECT ON public.vuln_anon_tautology TO anon, authenticated;

-- The base table for the view checks below. Correct in itself.
CREATE TABLE public.protected_ledger (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id  uuid NOT NULL,
    amount    numeric NOT NULL
);
ALTER TABLE public.protected_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.protected_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY protected_ledger_all ON public.protected_ledger
    FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
GRANT SELECT ON public.protected_ledger TO authenticated;

-- view-bypasses-rls: a plain view runs with its owner's privileges, so it reads
-- straight past the policy on protected_ledger.
CREATE VIEW public.vuln_ledger_view AS SELECT * FROM public.protected_ledger;
GRANT SELECT ON public.vuln_ledger_view TO anon, authenticated;

-- matview-bypasses-rls: a materialized view has no security_invoker option at
-- all — the rows are already copied out from under the policy.
CREATE MATERIALIZED VIEW public.vuln_ledger_matview AS SELECT * FROM public.protected_ledger;
GRANT SELECT ON public.vuln_ledger_matview TO anon, authenticated;

-- anonymous-write-allowed: an unauthenticated caller can insert.
CREATE TABLE public.vuln_anon_write (
    id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    body  text
);
ALTER TABLE public.vuln_anon_write ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vuln_anon_write FORCE ROW LEVEL SECURITY;
CREATE POLICY vuln_anon_write_insert ON public.vuln_anon_write
    FOR INSERT TO anon WITH CHECK (true);
GRANT INSERT ON public.vuln_anon_write TO anon;

-- Membership table for the subquery check. One FK, so it is not junction-shaped.
CREATE TABLE public.memberships (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id  uuid NOT NULL,
    org_id   uuid NOT NULL
);
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_select ON public.memberships
    FOR SELECT TO authenticated USING (user_id = auth.uid());
GRANT SELECT ON public.memberships TO authenticated;

-- unqualified-column-in-subquery: the second `org_id` binds to memberships, not
-- to the outer table, so the EXISTS is true for anyone who is a member of
-- anything. Postgres accepts it and deparses it as
-- `memberships.org_id = memberships.org_id`.
CREATE TABLE public.vuln_unqualified (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id  uuid NOT NULL,
    body    text
);
ALTER TABLE public.vuln_unqualified ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vuln_unqualified FORCE ROW LEVEL SECURITY;
CREATE POLICY vuln_unqualified_select ON public.vuln_unqualified
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.memberships
        WHERE memberships.user_id = auth.uid() AND org_id = org_id
    ));
GRANT SELECT ON public.vuln_unqualified TO authenticated;

-- junction-table-unprotected: both endpoints are locked down, the join table
-- between them is not — which is the whole edge list, readable by anyone.
CREATE TABLE public.posts (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id uuid NOT NULL,
    title     text
);
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts FORCE ROW LEVEL SECURITY;
CREATE POLICY posts_all ON public.posts
    FOR ALL TO authenticated USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());
GRANT SELECT ON public.posts TO authenticated;

CREATE TABLE public.tags (
    id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name  text
);
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags FORCE ROW LEVEL SECURITY;
CREATE POLICY tags_select ON public.tags FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.tags TO authenticated;

CREATE TABLE public.vuln_post_tags (
    post_id  uuid NOT NULL REFERENCES public.posts (id),
    tag_id   uuid NOT NULL REFERENCES public.tags (id),
    PRIMARY KEY (post_id, tag_id)
);
GRANT SELECT ON public.vuln_post_tags TO anon, authenticated;

-- rls-enabled-not-forced: the policy is right, but the table owner (and
-- anything running as it, including most SECURITY DEFINER functions) skips it.
CREATE TABLE public.vuln_not_forced (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id  uuid NOT NULL,
    body      text
);
ALTER TABLE public.vuln_not_forced ENABLE ROW LEVEL SECURITY;
CREATE POLICY vuln_not_forced_all ON public.vuln_not_forced
    FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
GRANT SELECT ON public.vuln_not_forced TO authenticated;

-- rls-enabled-no-policies: locked, not secured. Every query returns zero rows,
-- which is usually a bug rather than a decision.
CREATE TABLE public.vuln_no_policies (
    id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    body  text
);
ALTER TABLE public.vuln_no_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vuln_no_policies FORCE ROW LEVEL SECURITY;
GRANT SELECT ON public.vuln_no_policies TO authenticated;

-- policy-role-unreachable: the only policy is granted to a role no caller can
-- become, so the table behaves as if it had no policy at all.
CREATE TABLE public.vuln_unreachable_policy (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id  uuid NOT NULL,
    body      text
);
ALTER TABLE public.vuln_unreachable_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vuln_unreachable_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY vuln_unreachable_policy_select ON public.vuln_unreachable_policy
    FOR SELECT TO reporting_bot USING (owner_id = auth.uid());
GRANT SELECT ON public.vuln_unreachable_policy TO authenticated;

-- grant-to-public: the policy is fine; the grant hands the table to every role
-- in the cluster, present and future.
CREATE TABLE public.vuln_grant_public (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id  uuid NOT NULL,
    body      text
);
ALTER TABLE public.vuln_grant_public ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vuln_grant_public FORCE ROW LEVEL SECURITY;
CREATE POLICY vuln_grant_public_all ON public.vuln_grant_public
    FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
GRANT SELECT ON public.vuln_grant_public TO PUBLIC;

-- security-definer-mutable-search-path: runs as its owner with an unpinned
-- search_path, so a caller who can create objects can decide what `now()` means.
CREATE FUNCTION public.vuln_definer_fn(target uuid) RETURNS integer
    LANGUAGE sql SECURITY DEFINER
    AS $$ SELECT count(*)::int FROM public.protected_ledger WHERE owner_id = target $$;

-- current-setting-throws: no `missing_ok` argument, so the policy raises
-- 42704 instead of returning no rows whenever the GUC is not set.
CREATE TABLE public.vuln_current_setting (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  text NOT NULL,
    body       text
);
ALTER TABLE public.vuln_current_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vuln_current_setting FORCE ROW LEVEL SECURITY;
CREATE POLICY vuln_current_setting_select ON public.vuln_current_setting
    FOR SELECT TO authenticated USING (tenant_id = current_setting('app.tenant_id'));
GRANT SELECT ON public.vuln_current_setting TO authenticated;

-- ---------------------------------------------------------------------------
-- A second schema, so `--schema public` has something to exclude.
-- ---------------------------------------------------------------------------

CREATE SCHEMA private_ops;
GRANT USAGE ON SCHEMA private_ops TO anon;

CREATE TABLE private_ops.vuln_audit_log (
    id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    note  text
);
GRANT SELECT ON private_ops.vuln_audit_log TO anon;

-- ---------------------------------------------------------------------------
-- A database served by a role this tool does not recognise by name.
--
-- `custom_role_table` is exactly as open as `vuln_rls_disabled` — RLS off, full
-- DML to a role an untrusted caller arrives as — but the role is called
-- `app_user` rather than `anon`/`authenticated`/`web_anon`/`rebase_user`. Every
-- check gates on a grant to an *exposed* role, so before `--role` existed this
-- table produced nothing and the scan reported a clean database.
--
-- Deliberately named neither `vuln_*` nor `secure_*`: it is not a defect the
-- default scan is expected to find, and it is not an object that must stay
-- silent. It is the one case whose correct behaviour depends on the flag.
-- ---------------------------------------------------------------------------

CREATE ROLE app_user NOLOGIN;
GRANT USAGE ON SCHEMA public TO app_user;

CREATE TABLE public.custom_role_table (
    id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id  uuid,
    secret    text
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_role_table TO app_user;
