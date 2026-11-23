#!/bin/sh
# ─── First-boot roles for the self-hosted database ────────────────────────────
#
# The Postgres image runs every script in /docker-entrypoint-initdb.d once, as
# the superuser, the first time the data volume is empty. This one gives the
# runtime the same shape of database Rebase Cloud gives it:
#
#   - `rebase_app` (REBASE_DB_USER), a NON-superuser that owns the `rebase`
#     database (REBASE_DB_NAME). The runtime
#     connects as it. A superuser connection passes every privilege check, so a
#     schema that only boots because of one would boot here and fail on Cloud,
#     where the owner is not a superuser either.
#   - `vector` created as the superuser, in template1 and so in every database
#     made from it — `rebase`, the scratch copy `rebase db push` plans in, and
#     `rebase db branch` copies. It is the one extension the scaffold may need
#     that a non-superuser cannot create; `pg_trgm` and `unaccent` (search) are
#     trusted, so the owner creates those itself.
#   - the framework roles row-level security switches to, created up front so
#     the owner needs no CREATEROLE — the same statements Cloud runs at initdb.
#
# `rebase_app` also holds CREATEDB, which Cloud's owner does not: `rebase db push`
# and `rebase db branch` create databases beside this one, and here they run
# against this server directly.
#
# Finally the superuser loses its password, so it cannot be reached over the
# network at all. For superuser work, use the container's local socket:
#   docker compose exec db psql -U postgres -d rebase
#
# Runs once. An existing volume is never touched — to start over, remove it
# (`docker compose down -v`, which deletes the data).
# ──────────────────────────────────────────────────────────────────────────────
set -eu

: "${REBASE_DB_USER:?REBASE_DB_USER must be set on the db service}"
: "${REBASE_DB_PASSWORD:?REBASE_DB_PASSWORD must be set on the db service}"
: "${REBASE_DB_NAME:?REBASE_DB_NAME must be set on the db service}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    -v app_role="$REBASE_DB_USER" -v app_password="$REBASE_DB_PASSWORD" -v superuser="$POSTGRES_USER" -v app_db="$REBASE_DB_NAME" <<'SQL'
\connect template1
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

\connect postgres
CREATE ROLE :"app_role" LOGIN NOSUPERUSER CREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'app_password';
CREATE DATABASE :"app_db" OWNER :"app_role";

\connect :app_db
CREATE ROLE rebase_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_user TO :"app_role";
-- `shared_preload_libraries` and friends are superuser-only to read; this
-- built-in role makes settings readable and nothing writable.
GRANT pg_read_all_settings TO :"app_role";
-- The admin policy role and the admin request roles, with the memberships the
-- runtime's own provisioning makes (server-postgres security/rls-enforcement.ts).
CREATE ROLE rebase_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_admin TO :"app_role" WITH INHERIT TRUE, SET FALSE;
CREATE ROLE rebase_user_admin NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE rebase_admin_request NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
GRANT rebase_user_admin TO :"app_role" WITH SET TRUE, INHERIT FALSE;
GRANT rebase_user TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
GRANT rebase_admin TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;
GRANT rebase_admin_request TO rebase_user_admin WITH INHERIT TRUE, SET FALSE;

ALTER ROLE :"superuser" PASSWORD NULL;
SQL
