-- ─────────────────────────────────────────────────────────────────────────────
-- Era 1b — after the uid rename, before session-scoped refresh tokens.
--
-- This is auth schema version 1 as `auth/schema-version.ts` describes it, and
-- the era most deployed databases were actually in when the rotation migration
-- landed: dependent tables already key on `uid`, `users` already carries the
-- inline `roles TEXT[]`, but a refresh token row is still a device session
-- pinned by `unique_device_session UNIQUE (uid, user_agent, ip_address)`.
--
-- Kept separate from era-1a rather than folded into it because the two exercise
-- different paths: 1a proves the expand/contract and legacy-roles migrations
-- still work, this one isolates the rotation migration on a database where
-- nothing else is out of date. A single combined snapshot would let a
-- regression in one hide behind a failure in the other.
--
-- Unstamped on purpose: `schema_meta` did not exist in this era, so
-- readAuthSchemaVersion() must read null here and treat it as "upgrade me",
-- not as version 0.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS rebase;

CREATE TABLE rebase.users (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    email VARCHAR(255) UNIQUE NOT NULL,
    display_name VARCHAR(255),
    photo_url VARCHAR(500),
    roles TEXT[] DEFAULT '{}' NOT NULL,
    password_hash VARCHAR(255),
    email_verified BOOLEAN DEFAULT FALSE NOT NULL,
    is_anonymous BOOLEAN DEFAULT FALSE NOT NULL,
    metadata JSONB DEFAULT '{}' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    -- `email_verification_token`, `email_verification_sent_at` and
    -- `tokens_valid_after` are absent: they arrive by back-fill, and
    -- tokens_valid_after in particular is read on every refresh.
);

CREATE TABLE rebase.user_identities (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    uid TEXT NOT NULL REFERENCES rebase.users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    profile_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (provider, provider_id)
);

CREATE TABLE rebase.refresh_tokens (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    uid TEXT NOT NULL REFERENCES rebase.users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    user_agent TEXT,
    ip_address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_device_session UNIQUE (uid, user_agent, ip_address)
);

CREATE INDEX idx_refresh_tokens_hash ON rebase.refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_user ON rebase.refresh_tokens(uid);

CREATE TABLE rebase.password_reset_tokens (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    uid TEXT NOT NULL REFERENCES rebase.users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── Data ─────────────────────────────────────────────────────────────────────

INSERT INTO rebase.users (id, email, display_name, roles, password_hash, email_verified) VALUES
    ('user-era1b-admin', 'admin@era1b.test', 'Era 1b Admin', ARRAY['admin'],
     '$2b$10$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTU', TRUE);

-- Two devices, one user — legal under the old constraint only because the user
-- agent differs. Both are live sessions that must survive the upgrade with
-- distinct session ids: collapsing them into one would mean a single logout on
-- the phone silently kills the laptop.
INSERT INTO rebase.refresh_tokens (id, uid, token_hash, expires_at, user_agent, ip_address, created_at) VALUES
    ('token-era1b-laptop', 'user-era1b-admin', 'era1b-laptop-token-hash',
     NOW() + INTERVAL '30 days', 'Mozilla/5.0 (Macintosh)', '198.51.100.7', NOW() - INTERVAL '5 days'),
    ('token-era1b-phone', 'user-era1b-admin', 'era1b-phone-token-hash',
     NOW() + INTERVAL '30 days', 'Mozilla/5.0 (iPhone)', '198.51.100.7', NOW() - INTERVAL '3 hours');
