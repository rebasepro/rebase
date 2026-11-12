-- A Rebase scaffold's database, exactly as the runtime provisions it at boot.
--
-- NOT hand-written. This is `pg_dump -s` of a database that
-- `packages/cli/templates/template/backend/schema/*` was booted against —
-- the four scaffold tables (posts, authors, tags, and the `rebase.users`
-- auth table), the `posts_tags` junction the many-to-many derives, the
-- auth and internal tables boot creates, the `rebase.uid()` / `rebase.roles()`
-- helpers the policies call, and the request roles (`rebase_user`, and the
-- `rebase_admin` family admin policies are written to) with their grants. It
-- exists so `scaffold-baseline.e2e.test.ts` can assert what `rls-check` says
-- about a stock Rebase project on day one: the baseline is a product decision
-- (the scaffold's `defaultRls` grants unfiltered reads on purpose;
-- `posts` reads only published rows), and a scanner that quietly starts saying
-- something else about it — in either direction — is a regression in one of
-- the two.
--
-- To re-record after a change to the scaffold's tables or to boot-time
-- provisioning:
--
--   1. start an empty Postgres, as a role not named `rebase` (a role named
--      like a schema shadows it on `search_path`);
--   2. import the template's `backend/schema/index.ts` and boot its tables
--      with `initializeRebaseBackend({ tables: <every exported table>,
--      defaultRls, database: createPostgresAdapter(…), auth: { jwtSecret },
--      provisionSchema: true })` (the auth table is the `defineAuthTable`
--      among them), then shut it down;
--   3. `pg_dump -s`, then drop the pg_dump preamble (comments, `SET`,
--      `set_config`, `\restrict`), the comments and blank lines between
--      statements, the `OWNER TO` lines and the `FOR ROLE <owner>` of the
--      default-privilege grants, so the file applies as whoever runs it;
--   4. write the `rebase_*` roles and memberships from
--      `pg_dumpall --roles-only` above it, without `GRANTED BY`.
--
-- Recorded 2026-11-12 against feat/postgres-first-baas@b61e063d4d (package version
-- 0.30.1), PostgreSQL 18.6. Against the 2026-11-11 recording the scaffold's
-- own tables, policies, functions and grants are byte-identical; the
-- additions are framework tables boot now provisions (`rebase.cron_claims`,
-- `rebase.cron_job_state`, `rebase.cron_logs`, `rebase.ui_preferences`).

-- Boot creates these; they are cluster objects, so `pg_dump` of one database
-- does not carry them.
CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE rebase_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE rebase_admin_request NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE rebase_user_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_admin TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
GRANT rebase_admin_request TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
GRANT rebase_user TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;

CREATE SCHEMA rebase;
CREATE TYPE public.posts_status AS ENUM (
    'draft',
    'review',
    'published'
);
CREATE FUNCTION rebase.is_anonymous() RETURNS boolean
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
    SELECT COALESCE(NULLIF(current_setting('app.is_anonymous', true), ''), 'false')::boolean;
$$;
CREATE FUNCTION rebase.jwt() RETURNS jsonb
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
    SELECT COALESCE(
        NULLIF(current_setting('app.jwt', true), ''),
        '{}'
    )::jsonb;
$$;
CREATE FUNCTION rebase.rebase_cdc_notify() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    rec     jsonb;
    ident   jsonb := '{}'::jsonb;
    col     text;
    payload text;
BEGIN
    -- The common key, read on its own: no other column is fetched.
    IF TG_NARGS = 1 AND TG_ARGV[0] = 'id' THEN
        BEGIN
            IF (TG_OP = 'DELETE') THEN
                ident := jsonb_build_object('id', OLD.id);
            ELSE
                ident := jsonb_build_object('id', NEW.id);
            END IF;
        EXCEPTION WHEN undefined_column THEN
            ident := '{}'::jsonb;
        END;
    END IF;

    IF ident = '{}'::jsonb THEN
        -- The tuple is read here and never leaves this function: only the
        -- identity below is put on the channel.
        IF (TG_OP = 'DELETE') THEN
            rec := to_jsonb(OLD);
        ELSE
            rec := to_jsonb(NEW);
        END IF;

        FOR n IN 0 .. TG_NARGS - 1 LOOP
            col := TG_ARGV[n];
            IF rec ? col THEN
                ident := ident || jsonb_build_object(col, rec -> col);
            END IF;
        END LOOP;

        IF ident = '{}'::jsonb THEN
            SELECT coalesce(jsonb_object_agg(a.attname, rec -> a.attname), '{}'::jsonb) INTO ident
            FROM pg_index i
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
            WHERE i.indrelid = TG_RELID AND i.indisprimary;
        END IF;

        IF ident = '{}'::jsonb AND rec ? 'id' THEN
            ident := jsonb_build_object('id', rec -> 'id');
        END IF;
    END IF;

    payload := json_build_object(
        'schema', TG_TABLE_SCHEMA,
        'table',  TG_TABLE_NAME,
        'op',     TG_OP,
        'row',    ident
    )::text;

    -- Never let CDC abort the write: a key too large to notify is sent as no
    -- key, which the consumer treats as a change to the whole collection.
    IF (octet_length(payload) > 7900) THEN
        payload := json_build_object(
            'schema',    TG_TABLE_SCHEMA,
            'table',     TG_TABLE_NAME,
            'op',        TG_OP,
            'row',       '{}'::jsonb,
            'truncated', true
        )::text;
    END IF;

    PERFORM pg_notify('rebase_cdc', payload);
    RETURN NULL;
END;
$$;
CREATE FUNCTION rebase.rebase_cdc_notify_statement() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    -- One row per notification until then: see CDC_ROW_COMPAT_MS in trigger-cdc.ts.
    compat_until CONSTANT timestamptz := '-infinity';
    head    text;
    cols    text[];
    collist text;
    n       bigint;
    one     text;
    budget  bigint;
    chunks  text[];
    chunk   text;
    payload text;
BEGIN
    head := format('{"schema":%s,"table":%s,"op":%s', to_json(TG_TABLE_SCHEMA::text), to_json(TG_TABLE_NAME::text), to_json(TG_OP::text));
    IF TG_OP = 'TRUNCATE' THEN
        PERFORM pg_notify('rebase_cdc', head || '}');
        RETURN NULL;
    END IF;

    IF TG_NARGS = 1 AND TG_ARGV[0] = 'id' THEN
        BEGIN
            -- None, one, or more (no further), and the one named as the row trigger names it.
            IF TG_OP = 'DELETE' THEN
                SELECT count(*), max(json_build_object('id', t.id)::text) INTO n, one FROM (SELECT id FROM rebase_cdc_old LIMIT 2) t;
            ELSE
                SELECT count(*), max(json_build_object('id', t.id)::text) INTO n, one FROM (SELECT id FROM rebase_cdc_new LIMIT 2) t;
            END IF;
            IF n = 0 THEN
                RETURN NULL;
            END IF;
            IF n = 1 THEN
                payload := head || ',"row":' || one || '}';
                -- A key too large to notify is sent as no key: never let CDC abort the write.
                PERFORM pg_notify('rebase_cdc', CASE WHEN octet_length(payload) > 7900 THEN head || ',"row":{},"truncated":true}' ELSE payload END);
                RETURN NULL;
            END IF;
            IF now() < compat_until THEN
                IF TG_OP = 'DELETE' THEN
                    PERFORM pg_notify('rebase_cdc', CASE WHEN octet_length(p) > 7900 THEN head || ',"row":{},"truncated":true}' ELSE p END)
                       FROM (SELECT head || ',"row":' || json_build_object('id', t.id)::text || '}' AS p FROM rebase_cdc_old t) s;
                ELSE
                    PERFORM pg_notify('rebase_cdc', CASE WHEN octet_length(p) > 7900 THEN head || ',"row":{},"truncated":true}' ELSE p END)
                       FROM (SELECT head || ',"row":' || json_build_object('id', t.id)::text || '}' AS p FROM rebase_cdc_new t) s;
                END IF;
                RETURN NULL;
            END IF;
            budget := greatest(7900 - octet_length(head) - 25 - 64, 64);
            IF TG_OP = 'DELETE' THEN
                chunks := ARRAY(SELECT string_agg(k, ',') AS keys
                   FROM (SELECT k, (sum(octet_length(k) + 1) OVER (ROWS UNBOUNDED PRECEDING) - 1) / budget AS c
                           FROM (SELECT to_json(t.id)::text AS k FROM rebase_cdc_old t) s) s
                  GROUP BY c);
            ELSE
                chunks := ARRAY(SELECT string_agg(k, ',') AS keys
                   FROM (SELECT k, (sum(octet_length(k) + 1) OVER (ROWS UNBOUNDED PRECEDING) - 1) / budget AS c
                           FROM (SELECT to_json(t.id)::text AS k FROM rebase_cdc_new t) s) s
                  GROUP BY c);
            END IF;
            cols := ARRAY['id'];
        EXCEPTION WHEN undefined_column THEN
            -- `id` is gone since the trigger was attached: named below like any other key.
            cols := NULL;
        END;
    END IF;

    IF cols IS NULL THEN
        IF TG_OP = 'DELETE' THEN
            SELECT count(*) INTO n FROM (SELECT FROM rebase_cdc_old LIMIT 2) s;
        ELSE
            SELECT count(*) INTO n FROM (SELECT FROM rebase_cdc_new LIMIT 2) s;
        END IF;
        IF n = 0 THEN
            RETURN NULL;
        END IF;
        cols := ARRAY(SELECT x.col FROM unnest(TG_ARGV) WITH ORDINALITY AS x(col, i)
                       WHERE EXISTS (SELECT FROM pg_attribute a
                                      WHERE a.attrelid = TG_RELID AND a.attname = x.col AND a.attnum > 0 AND NOT a.attisdropped)
                       ORDER BY x.i);
        IF cardinality(cols) = 0 THEN
            cols := ARRAY(SELECT a.attname::text FROM pg_index i
                            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
                           WHERE i.indrelid = TG_RELID AND i.indisprimary
                           ORDER BY a.attnum);
        END IF;
        IF cardinality(cols) = 0 AND EXISTS (SELECT FROM pg_attribute a
                                              WHERE a.attrelid = TG_RELID AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped) THEN
            cols := ARRAY['id'];
        END IF;
        IF cardinality(cols) = 0 THEN
            -- Nothing names a row of this table: a change to all of it.
            PERFORM pg_notify('rebase_cdc', head || ',"row":{}}');
            RETURN NULL;
        END IF;

        IF n = 1 OR now() < compat_until THEN
            EXECUTE format(
                'SELECT pg_notify(%L, CASE WHEN octet_length(p) > 7900 THEN %L ELSE p END)
                   FROM (SELECT %L || json_build_object(%s)::text || ''}'' AS p FROM %I t) s',
                'rebase_cdc', head || ',"row":{},"truncated":true}', head || ',"row":',
                (SELECT string_agg(format('%L, t.%I', c, c), ', ') FROM unnest(cols) AS c),
                CASE TG_OP WHEN 'DELETE' THEN 'rebase_cdc_old' ELSE 'rebase_cdc_new' END);
            RETURN NULL;
        END IF;

        collist := (SELECT string_agg(format('t.%I', c), ', ') FROM unnest(cols) AS c);
        budget := greatest(7900 - octet_length(head) - octet_length(to_json(cols)::text) - 20 - 64, 64);
        EXECUTE format(
            'SELECT ARRAY(SELECT string_agg(k, '','')
                            FROM (SELECT k, (sum(octet_length(k) + 1) OVER (ROWS UNBOUNDED PRECEDING) - 1) / %s AS c
                                    FROM (SELECT %s AS k FROM %I t) s) s
                           GROUP BY c)',
            budget,
            CASE WHEN cardinality(cols) = 1 THEN format('to_json(%s)::text', collist)
                 ELSE format('json_build_array(%s)::text', collist) END,
            CASE TG_OP WHEN 'DELETE' THEN 'rebase_cdc_old' ELSE 'rebase_cdc_new' END) INTO chunks;
    END IF;

    head := head || ',"cols":' || to_json(cols)::text || ',"keys":[';
    FOREACH chunk IN ARRAY chunks LOOP
        payload := head || chunk || ']}';
        IF octet_length(payload) <= 7900 THEN
            PERFORM pg_notify('rebase_cdc', payload);
        ELSE
            -- A key long enough to overflow its batch: each of the batch's keys on its own.
            PERFORM pg_notify('rebase_cdc', CASE WHEN octet_length(p) > 7900 THEN head || ',"row":{},"truncated":true}' ELSE p END)
               FROM (SELECT head || k.value::text || ']}' AS p FROM json_array_elements(('[' || chunk || ']')::json) AS k) s;
        END IF;
    END LOOP;
    RETURN NULL;
END;
$$;
CREATE FUNCTION rebase.roles() RETURNS text
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
    SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
$$;
CREATE FUNCTION rebase.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[0], now()));
    RETURN NEW;
END;
$$;
CREATE FUNCTION rebase.uid() RETURNS text
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
    SELECT COALESCE(
        NULLIF(current_setting('app.uid', true), ''),
        NULLIF(current_setting('app.user_id', true), '')
    );
$$;
CREATE TABLE public.authors (
    id integer NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    picture text
);
ALTER TABLE public.authors ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.authors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE public.posts (
    id integer NOT NULL,
    title text NOT NULL,
    content text,
    status public.posts_status,
    author_id integer
);
ALTER TABLE public.posts ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.posts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE public.posts_tags (
    post_id integer NOT NULL,
    tag_id integer NOT NULL
);
CREATE TABLE public.tags (
    id integer NOT NULL,
    name text NOT NULL
);
ALTER TABLE public.tags ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.tags_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
CREATE TABLE rebase.api_keys (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    name text NOT NULL,
    kind text DEFAULT 'service'::text NOT NULL,
    key_prefix text NOT NULL,
    key_hash text NOT NULL,
    scopes jsonb,
    roles jsonb DEFAULT '[]'::jsonb NOT NULL,
    owner_uid text,
    rate_limit integer,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone
);
CREATE TABLE rebase.app_config (
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE rebase.cron_claims (
    job_id text NOT NULL,
    slot timestamp with time zone NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE rebase.cron_job_state (
    job_id text NOT NULL,
    enabled boolean,
    updated_at timestamp with time zone,
    updated_by text,
    running_until timestamp with time zone,
    running_by text,
    total_runs bigint DEFAULT 0 NOT NULL,
    total_failures bigint DEFAULT 0 NOT NULL,
    last_run_at timestamp with time zone,
    last_duration_ms integer,
    last_success boolean,
    last_error text
);
CREATE TABLE rebase.cron_logs (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    job_id text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone NOT NULL,
    duration_ms integer NOT NULL,
    success boolean DEFAULT true NOT NULL,
    error text,
    result jsonb,
    logs jsonb,
    manual boolean DEFAULT false NOT NULL,
    counted boolean
);
CREATE TABLE rebase.magic_link_tokens (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    uid uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE rebase.metric_samples (
    at timestamp with time zone NOT NULL,
    series text NOT NULL,
    instance text NOT NULL,
    value double precision NOT NULL
);
CREATE TABLE rebase.mfa_challenges (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    factor_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    verified_at timestamp with time zone,
    ip_address text,
    attempts integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone NOT NULL
);
CREATE TABLE rebase.mfa_factors (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    uid uuid NOT NULL,
    factor_type text DEFAULT 'totp'::text NOT NULL,
    secret_encrypted text NOT NULL,
    friendly_name text,
    verified boolean DEFAULT false,
    last_used_counter bigint,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE rebase.password_reset_tokens (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    uid uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE rebase.recovery_codes (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    uid uuid NOT NULL,
    code_hash text NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE rebase.refresh_tokens (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    uid uuid NOT NULL,
    session_id text DEFAULT (gen_random_uuid())::text NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked boolean DEFAULT false NOT NULL,
    rotated_at timestamp with time zone,
    session_started_at timestamp with time zone DEFAULT now() NOT NULL,
    user_agent text,
    ip_address text,
    created_at timestamp with time zone DEFAULT now(),
    aal text,
    method text
);
CREATE TABLE rebase.schema_meta (
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE rebase.ui_preferences (
    scope text NOT NULL,
    owner text DEFAULT ''::text NOT NULL,
    table_slug text NOT NULL,
    preferences jsonb NOT NULL,
    updated_by text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ui_preferences_scope_check CHECK ((scope = ANY (ARRAY['workspace'::text, 'user'::text])))
);
CREATE TABLE rebase.user_identities (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    uid uuid NOT NULL,
    provider text NOT NULL,
    provider_id text NOT NULL,
    profile_data jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE rebase.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    display_name text,
    photo_url text,
    roles text[] DEFAULT '{}'::text[] NOT NULL,
    password_hash text,
    email_verified boolean DEFAULT false NOT NULL,
    email_verification_token text,
    email_verification_sent_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_anonymous boolean DEFAULT false NOT NULL,
    tokens_valid_after timestamp with time zone,
    disabled_at timestamp with time zone,
    pending_email text,
    email_change_token text,
    email_change_sent_at timestamp with time zone
);
ALTER TABLE ONLY public.authors
    ADD CONSTRAINT authors_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.posts_tags
    ADD CONSTRAINT posts_tags_pkey PRIMARY KEY (post_id, tag_id);
ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);
ALTER TABLE ONLY rebase.api_keys
    ADD CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash);
ALTER TABLE ONLY rebase.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);
ALTER TABLE ONLY rebase.app_config
    ADD CONSTRAINT app_config_pkey PRIMARY KEY (key);
ALTER TABLE ONLY rebase.cron_claims
    ADD CONSTRAINT cron_claims_pkey PRIMARY KEY (job_id, slot);
ALTER TABLE ONLY rebase.cron_job_state
    ADD CONSTRAINT cron_job_state_pkey PRIMARY KEY (job_id);
ALTER TABLE ONLY rebase.cron_logs
    ADD CONSTRAINT cron_logs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY rebase.magic_link_tokens
    ADD CONSTRAINT magic_link_tokens_pkey PRIMARY KEY (id);
ALTER TABLE ONLY rebase.magic_link_tokens
    ADD CONSTRAINT magic_link_tokens_token_hash_key UNIQUE (token_hash);
ALTER TABLE ONLY rebase.metric_samples
    ADD CONSTRAINT metric_samples_pkey PRIMARY KEY (series, instance, at);
ALTER TABLE ONLY rebase.mfa_challenges
    ADD CONSTRAINT mfa_challenges_pkey PRIMARY KEY (id);
ALTER TABLE ONLY rebase.mfa_factors
    ADD CONSTRAINT mfa_factors_pkey PRIMARY KEY (id);
ALTER TABLE ONLY rebase.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);
ALTER TABLE ONLY rebase.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_token_hash_key UNIQUE (token_hash);
ALTER TABLE ONLY rebase.recovery_codes
    ADD CONSTRAINT recovery_codes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY rebase.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);
ALTER TABLE ONLY rebase.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash);
ALTER TABLE ONLY rebase.schema_meta
    ADD CONSTRAINT schema_meta_pkey PRIMARY KEY (key);
ALTER TABLE ONLY rebase.ui_preferences
    ADD CONSTRAINT ui_preferences_pkey PRIMARY KEY (scope, owner, table_slug);
ALTER TABLE ONLY rebase.user_identities
    ADD CONSTRAINT user_identities_pkey PRIMARY KEY (id);
ALTER TABLE ONLY rebase.user_identities
    ADD CONSTRAINT user_identities_provider_provider_id_key UNIQUE (provider, provider_id);
ALTER TABLE rebase.users
    ADD CONSTRAINT users_email_length_check CHECK ((length(email) <= 320)) NOT VALID;
ALTER TABLE ONLY rebase.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);
CREATE INDEX posts_author_id_ix_00ad191 ON public.posts USING btree (author_id);
CREATE INDEX posts_tags_tag_id_ix_d4456f1 ON public.posts_tags USING btree (tag_id);
CREATE INDEX idx_api_keys_owner ON rebase.api_keys USING btree (owner_uid) WHERE (owner_uid IS NOT NULL);
CREATE INDEX idx_api_keys_prefix ON rebase.api_keys USING btree (key_prefix);
CREATE INDEX idx_cron_logs_job ON rebase.cron_logs USING btree (job_id, started_at DESC);
CREATE INDEX idx_cron_logs_started ON rebase.cron_logs USING btree (started_at);
CREATE INDEX idx_cron_logs_uncounted ON rebase.cron_logs USING btree (job_id, started_at DESC) WHERE (counted IS NULL);
CREATE INDEX idx_magic_link_tokens_user ON rebase.magic_link_tokens USING btree (uid);
CREATE INDEX idx_mfa_challenges_factor ON rebase.mfa_challenges USING btree (factor_id);
CREATE INDEX idx_mfa_factors_user ON rebase.mfa_factors USING btree (uid);
CREATE INDEX idx_password_reset_tokens_user ON rebase.password_reset_tokens USING btree (uid);
CREATE INDEX idx_recovery_codes_user ON rebase.recovery_codes USING btree (uid);
CREATE INDEX idx_refresh_tokens_session ON rebase.refresh_tokens USING btree (session_id);
CREATE INDEX idx_refresh_tokens_user ON rebase.refresh_tokens USING btree (uid);
CREATE INDEX idx_user_identities_user ON rebase.user_identities USING btree (uid);
CREATE INDEX metric_samples_series_recent ON rebase.metric_samples USING btree (series, at DESC);
CREATE INDEX users_email_change_token_idx ON rebase.users USING btree (email_change_token) WHERE (email_change_token IS NOT NULL);
CREATE UNIQUE INDEX users_email_lower_key ON rebase.users USING btree (lower(email));
CREATE INDEX users_email_verification_token_idx ON rebase.users USING btree (email_verification_token) WHERE (email_verification_token IS NOT NULL);
CREATE TRIGGER rebase_cdc_delete AFTER DELETE ON public.authors REFERENCING OLD TABLE AS rebase_cdc_old FOR EACH STATEMENT EXECUTE FUNCTION rebase.rebase_cdc_notify_statement('id');
CREATE TRIGGER rebase_cdc_delete AFTER DELETE ON public.posts REFERENCING OLD TABLE AS rebase_cdc_old FOR EACH STATEMENT EXECUTE FUNCTION rebase.rebase_cdc_notify_statement('id');
CREATE TRIGGER rebase_cdc_delete AFTER DELETE ON public.posts_tags REFERENCING OLD TABLE AS rebase_cdc_old FOR EACH STATEMENT EXECUTE FUNCTION rebase.rebase_cdc_notify_statement('post_id', 'tag_id');
CREATE TRIGGER rebase_cdc_delete AFTER DELETE ON public.tags REFERENCING OLD TABLE AS rebase_cdc_old FOR EACH STATEMENT EXECUTE FUNCTION rebase.rebase_cdc_notify_statement('id');
CREATE TRIGGER rebase_cdc_insert AFTER INSERT ON public.authors REFERENCING NEW TABLE AS rebase_cdc_new FOR EACH STATEMENT EXECUTE FUNCTION rebase.rebase_cdc_notify_statement('id');
CREATE TRIGGER rebase_cdc_insert AFTER INSERT ON public.posts REFERENCING NEW TABLE AS rebase_cdc_new FOR EACH STATEMENT EXECUTE FUNCTION rebase.rebase_cdc_notify_statement('id');
CREATE TRIGGER rebase_cdc_insert AFTER INSERT ON public.posts_tags REFERENCING NEW TABLE AS rebase_cdc_new FOR EACH STATEMENT EXECUTE FUNCTION rebase.rebase_cdc_notify_statement('post_id', 'tag_id');
CREATE TRIGGER rebase_cdc_insert AFTER INSERT ON public.tags REFERENCING NEW TABLE AS rebase_cdc_new FOR EACH STATEMENT EXECUTE FUNCTION rebase.rebase_cdc_notify_statement('id');
CREATE TRIGGER rebase_cdc_truncate AFTER TRUNCATE ON public.authors FOR EACH STATEMENT EXECUTE FUNCTION rebase.rebase_cdc_notify_statement('id');
CREATE TRIGGER rebase_cdc_truncate AFTER TRUNCATE ON public.posts FOR EACH STATEMENT EXECUTE FUNCTION rebase.rebase_cdc_notify_statement('id');
CREATE TRIGGER rebase_cdc_truncate AFTER TRUNCATE ON public.posts_tags FOR EACH STATEMENT EXECUTE FUNCTION rebase.rebase_cdc_notify_statement('post_id', 'tag_id');
CREATE TRIGGER rebase_cdc_truncate AFTER TRUNCATE ON public.tags FOR EACH STATEMENT EXECUTE FUNCTION rebase.rebase_cdc_notify_statement('id');
CREATE TRIGGER rebase_cdc_update AFTER UPDATE ON public.authors REFERENCING NEW TABLE AS rebase_cdc_new FOR EACH STATEMENT EXECUTE FUNCTION rebase.rebase_cdc_notify_statement('id');
CREATE TRIGGER rebase_cdc_update AFTER UPDATE ON public.posts REFERENCING NEW TABLE AS rebase_cdc_new FOR EACH STATEMENT EXECUTE FUNCTION rebase.rebase_cdc_notify_statement('id');
CREATE TRIGGER rebase_cdc_update AFTER UPDATE ON public.posts_tags REFERENCING NEW TABLE AS rebase_cdc_new FOR EACH STATEMENT EXECUTE FUNCTION rebase.rebase_cdc_notify_statement('post_id', 'tag_id');
CREATE TRIGGER rebase_cdc_update AFTER UPDATE ON public.tags REFERENCING NEW TABLE AS rebase_cdc_new FOR EACH STATEMENT EXECUTE FUNCTION rebase.rebase_cdc_notify_statement('id');
CREATE TRIGGER rebase_cdc_delete AFTER DELETE ON rebase.users REFERENCING OLD TABLE AS rebase_cdc_old FOR EACH STATEMENT EXECUTE FUNCTION rebase.rebase_cdc_notify_statement('id');
CREATE TRIGGER rebase_cdc_insert AFTER INSERT ON rebase.users REFERENCING NEW TABLE AS rebase_cdc_new FOR EACH STATEMENT EXECUTE FUNCTION rebase.rebase_cdc_notify_statement('id');
CREATE TRIGGER rebase_cdc_truncate AFTER TRUNCATE ON rebase.users FOR EACH STATEMENT EXECUTE FUNCTION rebase.rebase_cdc_notify_statement('id');
CREATE TRIGGER rebase_cdc_update AFTER UPDATE ON rebase.users REFERENCING NEW TABLE AS rebase_cdc_new FOR EACH STATEMENT EXECUTE FUNCTION rebase.rebase_cdc_notify_statement('id');
CREATE TRIGGER users_updated_at_touch BEFORE UPDATE ON rebase.users FOR EACH ROW EXECUTE FUNCTION rebase.set_updated_at('updated_at');
ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.authors(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.posts_tags
    ADD CONSTRAINT posts_tags_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.posts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.posts_tags
    ADD CONSTRAINT posts_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;
ALTER TABLE ONLY rebase.magic_link_tokens
    ADD CONSTRAINT magic_link_tokens_uid_fkey FOREIGN KEY (uid) REFERENCES rebase.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY rebase.mfa_challenges
    ADD CONSTRAINT mfa_challenges_factor_id_fkey FOREIGN KEY (factor_id) REFERENCES rebase.mfa_factors(id) ON DELETE CASCADE;
ALTER TABLE ONLY rebase.mfa_factors
    ADD CONSTRAINT mfa_factors_uid_fkey FOREIGN KEY (uid) REFERENCES rebase.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY rebase.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_uid_fkey FOREIGN KEY (uid) REFERENCES rebase.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY rebase.recovery_codes
    ADD CONSTRAINT recovery_codes_uid_fkey FOREIGN KEY (uid) REFERENCES rebase.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY rebase.refresh_tokens
    ADD CONSTRAINT refresh_tokens_uid_fkey FOREIGN KEY (uid) REFERENCES rebase.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY rebase.user_identities
    ADD CONSTRAINT user_identities_uid_fkey FOREIGN KEY (uid) REFERENCES rebase.users(id) ON DELETE CASCADE;
ALTER TABLE public.authors ENABLE ROW LEVEL SECURITY;
CREATE POLICY authors_default_admin_read ON public.authors FOR SELECT TO rebase_admin USING (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))));
COMMENT ON POLICY authors_default_admin_read ON public.authors IS 'rebase:395e730c0f5ffab374e5e02ebb756e47bf6a0f59775f1c6a38eea0a38aa182f0';
CREATE POLICY authors_default_admin_read_ar_58ab3697 ON public.authors FOR SELECT TO rebase_admin_request USING (true);
COMMENT ON POLICY authors_default_admin_read_ar_58ab3697 ON public.authors IS 'rebase:f1377befd40a27090a6f129ce4d8137cf81b8656757b811631b749932d943b60';
CREATE POLICY authors_default_admin_write_delete ON public.authors FOR DELETE TO rebase_admin USING (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))));
COMMENT ON POLICY authors_default_admin_write_delete ON public.authors IS 'rebase:e86ff400fc6e8913d6aee71816550a0dc6785940b381c3c8b53555db74f3e97c';
CREATE POLICY authors_default_admin_write_delete_ar_a8ded2de ON public.authors FOR DELETE TO rebase_admin_request USING (true);
COMMENT ON POLICY authors_default_admin_write_delete_ar_a8ded2de ON public.authors IS 'rebase:28d9365e028270bc42736ebd4dc0b40ae076287e03a83ee9c711e676a20768b6';
CREATE POLICY authors_default_admin_write_insert ON public.authors FOR INSERT TO rebase_admin WITH CHECK (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))));
COMMENT ON POLICY authors_default_admin_write_insert ON public.authors IS 'rebase:4731fa2b02956a6b24c25a1ef2e7ee30c50cc369cedbd9f3a89269bbe784cb6b';
CREATE POLICY authors_default_admin_write_insert_ar_14e16377 ON public.authors FOR INSERT TO rebase_admin_request WITH CHECK (true);
COMMENT ON POLICY authors_default_admin_write_insert_ar_14e16377 ON public.authors IS 'rebase:3d53d29f27817842a4f69bb0d41d0c1a69146b39304f8ab80b4efe4f515cd494';
CREATE POLICY authors_default_admin_write_update ON public.authors FOR UPDATE TO rebase_admin USING (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text])))) WITH CHECK (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))));
COMMENT ON POLICY authors_default_admin_write_update ON public.authors IS 'rebase:72dc7e755f0b4561b80b80471e37b143be3e41424e3188d03ba048a7de13014d';
CREATE POLICY authors_default_admin_write_update_ar_60af55bd ON public.authors FOR UPDATE TO rebase_admin_request USING (true) WITH CHECK (true);
COMMENT ON POLICY authors_default_admin_write_update_ar_60af55bd ON public.authors IS 'rebase:dd9a4ce0bb348088776d93bd59f8d7b3a86286d597645f205de4f9ed97501a82';
CREATE POLICY authors_delete_3561e70_2 ON public.authors FOR DELETE TO rebase_admin USING (( SELECT (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text])));
COMMENT ON POLICY authors_delete_3561e70_2 ON public.authors IS 'rebase:851d306c2e0c01949f84a2127718fb2959404a9b17286491380b80f5b8f03322';
CREATE POLICY authors_delete_3561e70_2_ar_16f81a8f ON public.authors FOR DELETE TO rebase_admin_request USING (true);
COMMENT ON POLICY authors_delete_3561e70_2_ar_16f81a8f ON public.authors IS 'rebase:48443dc0e3a1b0b6602847534f4107b83c54c7560cc799eb48e7c197828e64c9';
CREATE POLICY authors_insert_3561e70_0 ON public.authors FOR INSERT TO rebase_admin WITH CHECK (( SELECT (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text])));
COMMENT ON POLICY authors_insert_3561e70_0 ON public.authors IS 'rebase:e905556b2df47727c94eef4203a3f90b3d508cd441d5a4722e1455319494de4b';
CREATE POLICY authors_insert_3561e70_0_ar_95941ca6 ON public.authors FOR INSERT TO rebase_admin_request WITH CHECK (true);
COMMENT ON POLICY authors_insert_3561e70_0_ar_95941ca6 ON public.authors IS 'rebase:4f26e470a1e209eadc729b8501a3148bec147d4975675fbc006d4a94b0885aa4';
CREATE POLICY authors_select_841c287 ON public.authors FOR SELECT USING (true);
COMMENT ON POLICY authors_select_841c287 ON public.authors IS 'rebase:62b71253c357ff82f6ac6c81bcedeb381563a53b776ff58c108aef1c6a849333';
CREATE POLICY authors_update_3561e70_1 ON public.authors FOR UPDATE TO rebase_admin USING (( SELECT (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))) WITH CHECK (( SELECT (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text])));
COMMENT ON POLICY authors_update_3561e70_1 ON public.authors IS 'rebase:2c7e9e5cb0644211f4312c07a0722c896674aa3fdd81af9cbc46fc47b69fdbf6';
CREATE POLICY authors_update_3561e70_1_ar_d4f8a3ee ON public.authors FOR UPDATE TO rebase_admin_request USING (true) WITH CHECK (true);
COMMENT ON POLICY authors_update_3561e70_1_ar_d4f8a3ee ON public.authors IS 'rebase:ff499fcead7e5bf7d6dbe0eca031934908329ba26479f76dd45415b529e4a03e';
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY posts_default_admin_read ON public.posts FOR SELECT TO rebase_admin USING (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))));
COMMENT ON POLICY posts_default_admin_read ON public.posts IS 'rebase:56371dbb2ad776075a8e8e56c65b24025f3821014c7c9e7eadb7e49ee39750d2';
CREATE POLICY posts_default_admin_read_ar_99f56e3b ON public.posts FOR SELECT TO rebase_admin_request USING (true);
COMMENT ON POLICY posts_default_admin_read_ar_99f56e3b ON public.posts IS 'rebase:d6510b8dfc4415a45cd13d89b2379c697f931bedab96a29d6a29040d60e5fa6b';
CREATE POLICY posts_default_admin_write_delete ON public.posts FOR DELETE TO rebase_admin USING (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))));
COMMENT ON POLICY posts_default_admin_write_delete ON public.posts IS 'rebase:797d2820d83741cf0024c934cd0650f725514a486bffe38104bac7d49eadfaa5';
CREATE POLICY posts_default_admin_write_delete_ar_2461401c ON public.posts FOR DELETE TO rebase_admin_request USING (true);
COMMENT ON POLICY posts_default_admin_write_delete_ar_2461401c ON public.posts IS 'rebase:80ae2c7ff0f8a3e226bb3367b785118c5994e5554284e24817f55f4bd4e04e92';
CREATE POLICY posts_default_admin_write_insert ON public.posts FOR INSERT TO rebase_admin WITH CHECK (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))));
COMMENT ON POLICY posts_default_admin_write_insert ON public.posts IS 'rebase:8ed5f7a3a0da7af9efcde2b7597af31be50efe3c4d166d2d1534b0c0873d5b3f';
CREATE POLICY posts_default_admin_write_insert_ar_013fffeb ON public.posts FOR INSERT TO rebase_admin_request WITH CHECK (true);
COMMENT ON POLICY posts_default_admin_write_insert_ar_013fffeb ON public.posts IS 'rebase:ca7f0d6d17bf84a8d78adba83c533557647f6b17cdbc365fa5e2f87318fd0d8b';
CREATE POLICY posts_default_admin_write_update ON public.posts FOR UPDATE TO rebase_admin USING (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text])))) WITH CHECK (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))));
COMMENT ON POLICY posts_default_admin_write_update ON public.posts IS 'rebase:bad30adb1ddc0059004fc7b84148c784439c4c0c109fdf6643d26e17343d0232';
CREATE POLICY posts_default_admin_write_update_ar_3d716296 ON public.posts FOR UPDATE TO rebase_admin_request USING (true) WITH CHECK (true);
COMMENT ON POLICY posts_default_admin_write_update_ar_3d716296 ON public.posts IS 'rebase:4b14b9e21174d8a1d51c869bb15a95c97e1a5a3f1f3ca19c7c70b4cda05f3434';
CREATE POLICY posts_delete_3561e70_2 ON public.posts FOR DELETE TO rebase_admin USING (( SELECT (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text])));
COMMENT ON POLICY posts_delete_3561e70_2 ON public.posts IS 'rebase:36ea6d13aa23a8c19ab4183fd510e09785fb680ee2bca663f4d9e52c8503e273';
CREATE POLICY posts_delete_3561e70_2_ar_da0cd5d9 ON public.posts FOR DELETE TO rebase_admin_request USING (true);
COMMENT ON POLICY posts_delete_3561e70_2_ar_da0cd5d9 ON public.posts IS 'rebase:7b18a1e87deef750e383ddc0a67159f9591b900751f2ef193b353f73eaf12c6a';
CREATE POLICY posts_insert_3561e70_0 ON public.posts FOR INSERT TO rebase_admin WITH CHECK (( SELECT (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text])));
COMMENT ON POLICY posts_insert_3561e70_0 ON public.posts IS 'rebase:60a5195ce3f581b1a92121149d7d93d15c17180a6b73740a251c411a6ac1541c';
CREATE POLICY posts_insert_3561e70_0_ar_783e895d ON public.posts FOR INSERT TO rebase_admin_request WITH CHECK (true);
COMMENT ON POLICY posts_insert_3561e70_0_ar_783e895d ON public.posts IS 'rebase:d3d914ab3564e39ef20db565fa713a0e4aa93525d2cba9dd9d99ed0f9fde86de';
CREATE POLICY posts_select_6264b4d ON public.posts FOR SELECT USING (( SELECT (string_to_array(rebase.roles(), ','::text) && ARRAY['editor'::text])));
COMMENT ON POLICY posts_select_6264b4d ON public.posts IS 'rebase:fdd227e7d245111f5fa398e42e2c1260bc84f84ab625648430e307ad34471d63';
CREATE POLICY posts_select_f2fe10c ON public.posts FOR SELECT USING ((status = 'published'::public.posts_status));
COMMENT ON POLICY posts_select_f2fe10c ON public.posts IS 'rebase:ab23e54a59bc3c1ff94b23118f7d5626faf71a7065d7b9eacd8b9e66d33b3726';
ALTER TABLE public.posts_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY posts_tags_default_admin_read ON public.posts_tags FOR SELECT TO rebase_admin USING (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))));
COMMENT ON POLICY posts_tags_default_admin_read ON public.posts_tags IS 'rebase:09b9bb8373c0f8e374c7d91b2b7ce1dae6aff1de56d9a416a00de966ef010ac7';
CREATE POLICY posts_tags_default_admin_read_ar_79398cd8 ON public.posts_tags FOR SELECT TO rebase_admin_request USING (true);
COMMENT ON POLICY posts_tags_default_admin_read_ar_79398cd8 ON public.posts_tags IS 'rebase:31b1d9c0723d3bc0d0c3f095365faefcb5376617d8540a5f0df5a29eba04bac8';
CREATE POLICY posts_tags_default_admin_write_delete ON public.posts_tags FOR DELETE TO rebase_admin USING (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))));
COMMENT ON POLICY posts_tags_default_admin_write_delete ON public.posts_tags IS 'rebase:d2c5000bf908e96f254e2d8bb0fd01dbba0833c80f8734133f311624416ce23e';
CREATE POLICY posts_tags_default_admin_write_delete_ar_b4d576aa ON public.posts_tags FOR DELETE TO rebase_admin_request USING (true);
COMMENT ON POLICY posts_tags_default_admin_write_delete_ar_b4d576aa ON public.posts_tags IS 'rebase:82bc144b2018995a250958a0996f074f13ad36f019e0f47690605fde4e3adeae';
CREATE POLICY posts_tags_default_admin_write_insert ON public.posts_tags FOR INSERT TO rebase_admin WITH CHECK (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))));
COMMENT ON POLICY posts_tags_default_admin_write_insert ON public.posts_tags IS 'rebase:c9329e79d0d2723e8afa4088e5f0491338510898b329f9b247ae94b81f1ba004';
CREATE POLICY posts_tags_default_admin_write_insert_ar_c13fc632 ON public.posts_tags FOR INSERT TO rebase_admin_request WITH CHECK (true);
COMMENT ON POLICY posts_tags_default_admin_write_insert_ar_c13fc632 ON public.posts_tags IS 'rebase:42d3ac4134357a74d6f76553a458272ebd393e3193d40e2661f274c86389a7e4';
CREATE POLICY posts_tags_default_admin_write_update ON public.posts_tags FOR UPDATE TO rebase_admin USING (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text])))) WITH CHECK (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))));
COMMENT ON POLICY posts_tags_default_admin_write_update ON public.posts_tags IS 'rebase:b66ec453c862670430b505adc20a775f2668c2d411468abf6096084550db2d22';
CREATE POLICY posts_tags_default_admin_write_update_ar_a0915f75 ON public.posts_tags FOR UPDATE TO rebase_admin_request USING (true) WITH CHECK (true);
COMMENT ON POLICY posts_tags_default_admin_write_update_ar_a0915f75 ON public.posts_tags IS 'rebase:eee09095d7a48184c2ef07660f505116255b206ac963ee6ec331a684ff7c1ee2';
CREATE POLICY posts_tags_default_edge_read ON public.posts_tags FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.posts _ex0
  WHERE (_ex0.id = posts_tags.post_id))) AND (EXISTS ( SELECT 1
   FROM public.tags _ex1
  WHERE (_ex1.id = posts_tags.tag_id)))));
COMMENT ON POLICY posts_tags_default_edge_read ON public.posts_tags IS 'rebase:5e13ead17355e44dc5b81f9fec55418af69c42388c7e9ad5e87b6088891a3c94';
CREATE POLICY posts_tags_default_edge_write_delete ON public.posts_tags FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.posts _ex0
  WHERE ((_ex0.id = posts_tags.post_id) AND ( SELECT (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))))));
COMMENT ON POLICY posts_tags_default_edge_write_delete ON public.posts_tags IS 'rebase:edd0e08502e35a8ef189de85d96e20783087effed82bbfebd631f1af906d9da7';
CREATE POLICY posts_tags_default_edge_write_insert ON public.posts_tags FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.posts _ex0
  WHERE ((_ex0.id = posts_tags.post_id) AND ( SELECT (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))))));
COMMENT ON POLICY posts_tags_default_edge_write_insert ON public.posts_tags IS 'rebase:016b4bd4999d3f6008e46faf19913e45053bb98d54867da13c56b598ed90ca5f';
CREATE POLICY posts_tags_default_edge_write_update ON public.posts_tags FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.posts _ex0
  WHERE ((_ex0.id = posts_tags.post_id) AND ( SELECT (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.posts _ex0
  WHERE ((_ex0.id = posts_tags.post_id) AND ( SELECT (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))))));
COMMENT ON POLICY posts_tags_default_edge_write_update ON public.posts_tags IS 'rebase:67b103fecc75876a19e732f2929e3a388b66093e85de366d3f61d2b0afae0acd';
CREATE POLICY posts_update_3561e70_1 ON public.posts FOR UPDATE TO rebase_admin USING (( SELECT (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))) WITH CHECK (( SELECT (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text])));
COMMENT ON POLICY posts_update_3561e70_1 ON public.posts IS 'rebase:6e3cd9833392f2881f46196f6e62c187343ef03b42edfb84e0e1f39304b78f9c';
CREATE POLICY posts_update_3561e70_1_ar_6f223089 ON public.posts FOR UPDATE TO rebase_admin_request USING (true) WITH CHECK (true);
COMMENT ON POLICY posts_update_3561e70_1_ar_6f223089 ON public.posts IS 'rebase:820cf518eca2c369a6d862c92ca97629c58fd83dca238bf8d8c62f0fccdaa8dd';
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY tags_default_admin_read ON public.tags FOR SELECT TO rebase_admin USING (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))));
COMMENT ON POLICY tags_default_admin_read ON public.tags IS 'rebase:457bc9b39c9a1f089f45d85eda34a81b51f49414332a088799d322ba164be215';
CREATE POLICY tags_default_admin_read_ar_8bb5294e ON public.tags FOR SELECT TO rebase_admin_request USING (true);
COMMENT ON POLICY tags_default_admin_read_ar_8bb5294e ON public.tags IS 'rebase:e9a4206c9440eb7c0d2f8e4bbedc408a22ef4f3ba6adc2692f8d328ab9aa5bb9';
CREATE POLICY tags_default_admin_write_delete ON public.tags FOR DELETE TO rebase_admin USING (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))));
COMMENT ON POLICY tags_default_admin_write_delete ON public.tags IS 'rebase:92608fbcb465ea2afb390ae6a7f86a170f04ca9a8a880146964541b1b1eb718c';
CREATE POLICY tags_default_admin_write_delete_ar_a9150697 ON public.tags FOR DELETE TO rebase_admin_request USING (true);
COMMENT ON POLICY tags_default_admin_write_delete_ar_a9150697 ON public.tags IS 'rebase:39d83a5709136338f96d8f9218e5766f90d76660b942b742c02be8f2b408650f';
CREATE POLICY tags_default_admin_write_insert ON public.tags FOR INSERT TO rebase_admin WITH CHECK (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))));
COMMENT ON POLICY tags_default_admin_write_insert ON public.tags IS 'rebase:97c74504724e1c59269161dfe91c587a5bda4dae150d16f38ef9618da9260f33';
CREATE POLICY tags_default_admin_write_insert_ar_aa55f68d ON public.tags FOR INSERT TO rebase_admin_request WITH CHECK (true);
COMMENT ON POLICY tags_default_admin_write_insert_ar_aa55f68d ON public.tags IS 'rebase:495bd875969f85c4cc1a4bbeafdae9c33c80dcf5d4d66025bc499001178e2975';
CREATE POLICY tags_default_admin_write_update ON public.tags FOR UPDATE TO rebase_admin USING (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text])))) WITH CHECK (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))));
COMMENT ON POLICY tags_default_admin_write_update ON public.tags IS 'rebase:c1145c370cd1775623ad96a980bb2a835d8c1d2c25808d318df167b3fc4040b5';
CREATE POLICY tags_default_admin_write_update_ar_fcba2204 ON public.tags FOR UPDATE TO rebase_admin_request USING (true) WITH CHECK (true);
COMMENT ON POLICY tags_default_admin_write_update_ar_fcba2204 ON public.tags IS 'rebase:92e9dba4c94c2f09870e30311ce6d20be65afb11c2f619650716241255f3c78a';
CREATE POLICY tags_delete_3561e70_2 ON public.tags FOR DELETE TO rebase_admin USING (( SELECT (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text])));
COMMENT ON POLICY tags_delete_3561e70_2 ON public.tags IS 'rebase:6f95cc6d01f9955d566e5adc3906c9451c80ccb328fa51ce8f5de44d05a80c42';
CREATE POLICY tags_delete_3561e70_2_ar_401cd4a9 ON public.tags FOR DELETE TO rebase_admin_request USING (true);
COMMENT ON POLICY tags_delete_3561e70_2_ar_401cd4a9 ON public.tags IS 'rebase:2e2a21959734b658fd0d2ee0fbaca551e7a603818ea30bc5046390f8831f373c';
CREATE POLICY tags_insert_3561e70_0 ON public.tags FOR INSERT TO rebase_admin WITH CHECK (( SELECT (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text])));
COMMENT ON POLICY tags_insert_3561e70_0 ON public.tags IS 'rebase:59f6d2b228650d1eeded8a6496cc40633f4117c8c072da2831b3519fd0d91744';
CREATE POLICY tags_insert_3561e70_0_ar_e8006c2a ON public.tags FOR INSERT TO rebase_admin_request WITH CHECK (true);
COMMENT ON POLICY tags_insert_3561e70_0_ar_e8006c2a ON public.tags IS 'rebase:ad3f232ba41aa6330ae2209f04ed83375f3e244a36291cc5bae855a996313fd3';
CREATE POLICY tags_select_841c287 ON public.tags FOR SELECT USING (true);
COMMENT ON POLICY tags_select_841c287 ON public.tags IS 'rebase:20c6abc9a7b7495453e8d9004b3b837c4f3a1cdabe88a9cb00fd368ca89d5f90';
CREATE POLICY tags_update_3561e70_1 ON public.tags FOR UPDATE TO rebase_admin USING (( SELECT (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))) WITH CHECK (( SELECT (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text])));
COMMENT ON POLICY tags_update_3561e70_1 ON public.tags IS 'rebase:ae223749f45834315ed5b74b2c6e098a2142b566b7540da50db5a50becbf983b';
CREATE POLICY tags_update_3561e70_1_ar_f575070b ON public.tags FOR UPDATE TO rebase_admin_request USING (true) WITH CHECK (true);
COMMENT ON POLICY tags_update_3561e70_1_ar_f575070b ON public.tags IS 'rebase:7b59a49186557c9e3ef38e5c28cbd148b87466e7ce0acc06ec8db309490be533';
ALTER TABLE rebase.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_default_admin_read ON rebase.users FOR SELECT TO rebase_admin USING (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))));
COMMENT ON POLICY users_default_admin_read ON rebase.users IS 'rebase:795c494aae0848de2e536f72921a989b006c5889fe0c0bb8dea29e4d3c4bf214';
CREATE POLICY users_default_admin_read_ar_b3a52ae4 ON rebase.users FOR SELECT TO rebase_admin_request USING (true);
COMMENT ON POLICY users_default_admin_read_ar_b3a52ae4 ON rebase.users IS 'rebase:c0652d11741207c90f18910ae23366aaca4c906ec9ae4734255b28932c2d5fdc';
CREATE POLICY users_default_admin_write_delete ON rebase.users FOR DELETE TO rebase_admin USING (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))));
COMMENT ON POLICY users_default_admin_write_delete ON rebase.users IS 'rebase:c1cffad17e4b4d47af48e05a1cb60988203db1e4c3e56c2c64fc4e878fa2d687';
CREATE POLICY users_default_admin_write_delete_ar_7e609e9b ON rebase.users FOR DELETE TO rebase_admin_request USING (true);
COMMENT ON POLICY users_default_admin_write_delete_ar_7e609e9b ON rebase.users IS 'rebase:d95bfdef2fd9f90a79783bdac224c267a549d67d811a6601c989a0286c6600b7';
CREATE POLICY users_default_admin_write_insert ON rebase.users FOR INSERT TO rebase_admin WITH CHECK (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))));
COMMENT ON POLICY users_default_admin_write_insert ON rebase.users IS 'rebase:ea486f3e687ee4d61aea69bb96ad6ff7370eb63d1e1c8103811cd6ea857d4b75';
CREATE POLICY users_default_admin_write_insert_ar_f5b0fae5 ON rebase.users FOR INSERT TO rebase_admin_request WITH CHECK (true);
COMMENT ON POLICY users_default_admin_write_insert_ar_f5b0fae5 ON rebase.users IS 'rebase:ca351329d087d5db3975a2f8ebc5fd88b891426c3bd76bb66b2a73a22fbb2150';
CREATE POLICY users_default_admin_write_update ON rebase.users FOR UPDATE TO rebase_admin USING (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text])))) WITH CHECK (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))));
COMMENT ON POLICY users_default_admin_write_update ON rebase.users IS 'rebase:0c198fe78e4b663ef56e7698c52cc53bf75a74c8ebc08b0bfdce8ccc4fababd2';
CREATE POLICY users_default_admin_write_update_ar_687e5ca3 ON rebase.users FOR UPDATE TO rebase_admin_request USING (true) WITH CHECK (true);
COMMENT ON POLICY users_default_admin_write_update_ar_687e5ca3 ON rebase.users IS 'rebase:0d5532de1931beca11f2ae5ddb8a9627460d04e0800af1012f1c3f2789462a4f';
CREATE POLICY users_default_self_read ON rebase.users FOR SELECT USING (((id)::text = ( SELECT rebase.uid() AS uid)));
COMMENT ON POLICY users_default_self_read ON rebase.users IS 'rebase:30de33dd00153a8d146b8cdd80af27a203e84d7f10934bd5f81777e7d35d8c75';
CREATE POLICY users_delete_3561e70_2 ON rebase.users FOR DELETE TO rebase_admin USING (( SELECT (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text])));
COMMENT ON POLICY users_delete_3561e70_2 ON rebase.users IS 'rebase:d97d18944f79442d8a3fef6c40cf5093a99c0ad11b666fb0597bcb4361334f45';
CREATE POLICY users_delete_3561e70_2_ar_40c56324 ON rebase.users FOR DELETE TO rebase_admin_request USING (true);
COMMENT ON POLICY users_delete_3561e70_2_ar_40c56324 ON rebase.users IS 'rebase:e1d5cb889978f686877eb77bcffa834042bc6ced959dce1abc1399c0b21a5524';
CREATE POLICY users_insert_3561e70_0 ON rebase.users FOR INSERT TO rebase_admin WITH CHECK (( SELECT (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text])));
COMMENT ON POLICY users_insert_3561e70_0 ON rebase.users IS 'rebase:6074f0a311fcca6fcb196d68f642ac9342e1806d8499dd4ba23705bf3d79da5a';
CREATE POLICY users_insert_3561e70_0_ar_256f49d5 ON rebase.users FOR INSERT TO rebase_admin_request WITH CHECK (true);
COMMENT ON POLICY users_insert_3561e70_0_ar_256f49d5 ON rebase.users IS 'rebase:9ba41573b02ae7059be426a2fbaa97d9f048c1ba1032394f61957920b0340fe9';
CREATE POLICY users_require_admin_write_delete ON rebase.users AS RESTRICTIVE FOR DELETE USING (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))));
COMMENT ON POLICY users_require_admin_write_delete ON rebase.users IS 'rebase:eef67ebf8d9a42362d73b9225df0ada34caf41f997a29de9f377196b36736895';
CREATE POLICY users_require_admin_write_insert ON rebase.users AS RESTRICTIVE FOR INSERT WITH CHECK (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))));
COMMENT ON POLICY users_require_admin_write_insert ON rebase.users IS 'rebase:fd72784d960397f9467cb14f11902f07b4d894e86dec117da2f894f61c0b653e';
CREATE POLICY users_require_admin_write_update ON rebase.users AS RESTRICTIVE FOR UPDATE USING (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text])))) WITH CHECK (( SELECT ((rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))));
COMMENT ON POLICY users_require_admin_write_update ON rebase.users IS 'rebase:e72a46f49fd6e93e383cb54ac54935cc3b7071c1b5f530896dc1cd04d2a8f8fa';
CREATE POLICY users_select_5f32f06 ON rebase.users FOR SELECT TO rebase_admin USING (( SELECT (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text])));
COMMENT ON POLICY users_select_5f32f06 ON rebase.users IS 'rebase:82db1682240cea6ea1fcbfc8fa84cea2d0146a2db923cb5aa2a71047eedb5eab';
CREATE POLICY users_select_5f32f06_ar_c118f1a5 ON rebase.users FOR SELECT TO rebase_admin_request USING (true);
COMMENT ON POLICY users_select_5f32f06_ar_c118f1a5 ON rebase.users IS 'rebase:41573f7643177f0d16358d37685b6025d0cd74de4aa37b58cacb6b2dfb43a4ca';
CREATE POLICY users_update_3561e70_1 ON rebase.users FOR UPDATE TO rebase_admin USING (( SELECT (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))) WITH CHECK (( SELECT (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text])));
COMMENT ON POLICY users_update_3561e70_1 ON rebase.users IS 'rebase:d623465b2bdacc6feab5251eb086e5a4e23dd883bbdf06df6e06b8cc16d96dc8';
CREATE POLICY users_update_3561e70_1_ar_5be2f8fb ON rebase.users FOR UPDATE TO rebase_admin_request USING (true) WITH CHECK (true);
COMMENT ON POLICY users_update_3561e70_1_ar_5be2f8fb ON rebase.users IS 'rebase:1dc55519ecc31636ec515efd72e832595bfc406114fd154dd8060360354d450a';
GRANT USAGE ON SCHEMA public TO rebase_user;
GRANT USAGE ON SCHEMA rebase TO rebase_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.authors TO rebase_user;
GRANT SELECT,USAGE ON SEQUENCE public.authors_id_seq TO rebase_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.posts TO rebase_user;
GRANT SELECT,USAGE ON SEQUENCE public.posts_id_seq TO rebase_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.posts_tags TO rebase_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.tags TO rebase_user;
GRANT SELECT,USAGE ON SEQUENCE public.tags_id_seq TO rebase_user;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE rebase.users TO rebase_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,USAGE ON SEQUENCES TO rebase_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO rebase_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA rebase GRANT SELECT,USAGE ON SEQUENCES TO rebase_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA rebase GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO rebase_user;
