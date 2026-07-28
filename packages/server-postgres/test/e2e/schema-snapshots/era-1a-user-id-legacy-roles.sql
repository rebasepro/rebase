-- ─────────────────────────────────────────────────────────────────────────────
-- Era 1a — the oldest auth schema still plausibly deployed.
--
-- Reconstructed from the migrations that retired it, in ensure-tables.ts:
--   * dependent tables key on `user_id NOT NULL`; `uid` does not exist yet
--     (retired by the expand/contract migration around line 145)
--   * roles live in the `rebase.user_roles` / `rebase.roles` junction pair
--     (retired by the legacy-roles migration around line 462)
--   * `users` carries only the two columns that have existed since the first
--     era — every other column is expected to arrive by back-fill
--   * `refresh_tokens` is device-scoped: one row IS a session, pinned by
--     `unique_device_session`, with none of the rotation columns
--
-- Seeded on purpose. The DDL half of each migration is the easy half; the
-- back-fill is where an upgrade silently signs every user out or drops their
-- roles, and an empty table cannot catch it. See README.md.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS rebase;

-- `users` at its most minimal: id and email only. Everything in
-- `userColumnBackfills` must be added by the upgrade, and `email` is
-- deliberately the one column that cannot be.
CREATE TABLE rebase.users (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    email VARCHAR(255) UNIQUE NOT NULL
);

-- The junction pair that predates the inline `roles TEXT[]` column.
CREATE TABLE rebase.roles (
    id TEXT PRIMARY KEY,
    description TEXT
);

CREATE TABLE rebase.user_roles (
    user_id TEXT NOT NULL REFERENCES rebase.users(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES rebase.roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE rebase.user_identities (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL REFERENCES rebase.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    profile_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (provider, provider_id)
);

-- A row IS a device session. The constraint below is the one-way door: the
-- current runtime keeps two live tokens per session while a rotation is in
-- flight, and they share all three columns.
CREATE TABLE rebase.refresh_tokens (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL REFERENCES rebase.users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    user_agent TEXT,
    ip_address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_device_session UNIQUE (user_id, user_agent, ip_address)
);

CREATE TABLE rebase.password_reset_tokens (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL REFERENCES rebase.users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── Data ─────────────────────────────────────────────────────────────────────
-- Two users, so "the admin kept their roles" is distinguishable from "every
-- user was given every role".

INSERT INTO rebase.roles (id, description) VALUES
    ('admin',  'Full access'),
    ('editor', 'Content only');

INSERT INTO rebase.users (id, email) VALUES
    ('user-era1a-admin',  'admin@era1a.test'),
    ('user-era1a-reader', 'reader@era1a.test');

INSERT INTO rebase.user_roles (user_id, role_id) VALUES
    ('user-era1a-admin', 'admin'),
    ('user-era1a-admin', 'editor');
-- user-era1a-reader deliberately has no rows: it must end up with '{}', not
-- with NULL and not with the admin's roles.

INSERT INTO rebase.user_identities (id, user_id, provider, provider_id) VALUES
    ('identity-era1a-1', 'user-era1a-admin', 'google', 'google-oauth-subject-1');

-- A live session, mid-life: issued in the past, expiring well in the future.
-- It must still be there, still unrevoked, after the upgrade — the fix for
-- being signed out must not itself sign everyone out.
INSERT INTO rebase.refresh_tokens (id, user_id, token_hash, expires_at, user_agent, ip_address, created_at) VALUES
    ('token-era1a-live', 'user-era1a-admin', 'era1a-live-token-hash',
     NOW() + INTERVAL '30 days', 'Mozilla/5.0 (era-1a)', '203.0.113.10', NOW() - INTERVAL '2 days'),
    ('token-era1a-other', 'user-era1a-reader', 'era1a-other-token-hash',
     NOW() + INTERVAL '30 days', 'Mozilla/5.0 (era-1a)', '203.0.113.11', NOW() - INTERVAL '1 day');
