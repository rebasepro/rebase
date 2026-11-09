---
title: Running on an existing or shared database
sidebar_label: Existing or shared database
description: Run Rebase on a PostgreSQL database it does not own — a cluster shared with other apps, a second Rebase project, Supabase, or a database a DBA locks down — with the rls settings, rebase doctor --database and rebase db request-role migrate.
---

<span class="since-badge" data-since="0.30">Since 0.30</span>

## The problem

Rebase runs every signed-in and anonymous request as one restricted Postgres
role, `rebase_user`, and lets row-level security decide which rows that request
sees. The connection role owns the tables and bypasses RLS; each request
switches to `rebase_user` inside its transaction.

That works on a database Rebase owns outright: Rebase Cloud, the Docker setup
`rebase init` scaffolds, the managed development database. It rests on two
assumptions:

1. Only this project's server can become `rebase_user`.
2. Only `rebase_user` and the table owner touch Rebase's tables.

A database someone already runs often breaks both:

- **Roles belong to the whole cluster, not to one database.** Two Rebase
  projects on one cluster share the same `rebase_user`. By default every role
  may connect to every database, and anyone can set the session settings
  Rebase's policies read, so project A's connection can open project B's
  database, switch to `rebase_user` and pass B's policies as B's admin.
- **Grants cover whole schemas.** By default Rebase grants the request role
  `SELECT, INSERT, UPDATE, DELETE` on every table in `public` it may grant on,
  including tables another application owns.
- **Default policies apply `TO public`.** The baseline policy Rebase adds to
  every collection lets in any session that never set Rebase's identity. That
  is how the server's own queries pass, and it also lets in any other role
  that holds a grant on the table, such as Supabase's `anon` through its Data
  API.
- **Existing role-based policies never apply.** A policy written
  `TO authenticated` does not apply to `rebase_user`, because `rebase_user` does
  not inherit other roles' privileges.
- **Some databases do not let the app create roles at all.** A DBA creates
  every role by hand, or roles are managed in Terraform.

Every one of these has a setting. Each setting defaults to what Rebase does
without it, so a project that sets nothing behaves exactly as before.

## Check the database first

```bash
rebase doctor --database
```

It reads the catalogue of the project's database and changes nothing. It
reports:

- whether each request role exists, is restricted, and whether this connection
  may switch to it;
- other login roles that can switch into the request role;
- whether every role on the cluster may connect to this database;
- tables in Rebase's schemas that back no collection;
- other roles holding privileges on Rebase's tables;
- policies on Rebase's tables written `TO` a role the request role does not
  inherit;
- default privileges that hand new tables to other roles.

Each finding comes with the SQL to run as a database administrator, the
setting that adapts Rebase to the database instead, or both. It exits 1 when a
finding is a failure, so it can gate a deployment. It checks the database
against the settings it can see: the `REBASE_RLS_*` variables, then the request
roles a server boot recorded in the database.

`npx @rebasepro/rls-check` audits the policies themselves, on any Postgres. On
a Rebase database it reads the request role the same way; name it with
`--request-role` when it is not recorded yet.

## The settings

Set them on the database declaration in `config/resources.ts`:

```ts
import { database } from "@rebasepro/types";

export const main = database({
    rls: {
        requestRole: "acme_prod_user",
        grants: "managed"
    }
});
```

Or from the environment, which wins over the declaration. The environment is
what you want for a value that differs between two deployments of the same
code, such as the role name when staging and production share a cluster.

| Setting | Environment variable | Default | Alternatives |
|---|---|---|---|
| `requestRole` | `REBASE_RLS_REQUEST_ROLE` (a single name) | `"rebase_user"` | Any role name. `{ anonymous, signedIn }` to run callers with no session as one role and signed-in callers as another. In the driver's code, a function of the request's identity. |
| `requestRoles` | none | derived from `requestRole` | Every role a function-valued `requestRole` can return, so each can be provisioned, granted and checked. Required with a function. |
| `provisionRole` | `REBASE_RLS_PROVISION_ROLE` | `"auto"`: create the role if missing and grant this connection the right to switch to it | `"never"`: the role and the membership are yours. Boot checks both and fails with the SQL to run. |
| `grants` | `REBASE_RLS_GRANTS` | `"schema"`: every table and sequence in the schemas Rebase serves that the connection may grant on, plus default privileges for tables created later | `"managed"`: only the tables Rebase serves, and no default privileges. `"none"`: Rebase grants nothing; a table you have not granted is refused. |
| `policyTarget` | `REBASE_RLS_POLICY_TARGET` | `"public"` | `"requestRole"`: permissive policies apply only to the request role(s). Restrictive policies still apply to everyone. |
| `defaultPolicies` | `REBASE_RLS_DEFAULT_POLICIES` | `true` | `false`: no collection gets the server-or-admin baseline. A collection's own `disableDefaultPolicies` still decides for it. |
| `inheritRoles` | none | `[]` | Roles granted to the request role `WITH INHERIT TRUE`, so policies written `TO` them apply. With an `{ anonymous, signedIn }` request role, only the signed-in one gets them; with a function, the setting is refused. PostgreSQL 16 and newer; refused on 15 and older. |
| `identity` | `REBASE_RLS_IDENTITY` (named forms) | `"rebase"`: `app.uid`, `app.user_roles`, `app.is_anonymous`, `app.jwt` | `"supabase"`: also `request.jwt.claims`, `request.jwt.claim.sub` and `request.jwt.claim.role`, so `auth.uid()` and `auth.jwt()` see the caller. In the driver's code, a function returning extra settings. The `app.*` settings are always set. |
| `sharedRole` | `REBASE_RLS_SHARED_ROLE` | `"warn"` when another login can switch into the request role | `"refuse"`: fail the boot. `"ignore"`: say nothing. |

The function forms of `requestRole` and `identity` are accepted only in the
driver's own `rls` block, which takes the same settings. `policyTarget` and
`defaultPolicies` change the policy SQL that `rebase db generate` writes, and
the CLI cannot read the driver's code, so set those two on the declaration or
in the environment. A boot that finds them only in the driver's code refuses
to start.

At boot, the line that reports how requests are isolated lists every setting
that is not at its default. A setting that hands a job to you, such as
`grants: "none"`, says once which job that is.

The first provisioning boot records the request role(s) in
`rebase.schema_meta`. A later boot configured with a different role refuses to
start and names the command that moves the database, below. Without that
check, the old role would keep its grants while a new one was set up beside
it.

## Recipes

### A cluster shared with other apps or projects

Give each project, and each deployment that shares a cluster, a role of its
own:

```bash
REBASE_RLS_REQUEST_ROLE=acme_prod_user
```

A database that has already run as `rebase_user` records that, so first move
it:

```bash
rebase db request-role migrate --to acme_prod_user --dry-run
rebase db request-role migrate --to acme_prod_user
```

The command creates the new role if it is missing, re-issues in this database
only every grant the old role holds (tables, columns, sequences, schemas,
functions, the default privileges this connection set, and memberships),
re-points policies that name the old role, and records the new role. It runs
in one transaction. The old role is left as it is, because another database on
the cluster may still use it. When it finishes, it prints the `REVOKE`
statements that take the old role's grants back in this database, to run once
nothing here needs them. `--dry-run` prints the same statements and changes
nothing. On a terminal it asks before it runs; with no terminal it refuses
without `--yes`.

Then set `REBASE_RLS_REQUEST_ROLE` on every server that uses the database.

`rebase doctor --database` also reports that every role on the cluster may
connect to the database, with the `REVOKE CONNECT … FROM PUBLIC` that stops
it. Rebase does not run that itself on a database it does not own.

### Supabase

An existing Supabase schema already has `anon` and `authenticated`, and
policies written against them with `auth.uid()`. To have those policies apply
to Rebase's requests unchanged:

```ts
import { database } from "@rebasepro/types";

export const main = database({
    rls: {
        requestRole: { anonymous: "anon", signedIn: "authenticated" },
        identity: "supabase",
        policyTarget: "requestRole"
    }
});
```

- `requestRole` runs callers with no session as `anon` and everyone signed in
  (guests included) as `authenticated`.
- `identity: "supabase"` sets the `request.jwt.*` settings that `auth.uid()`
  reads. Without them, every `auth.uid() = owner_id` test fails, or passes
  when it should not.
- `policyTarget: "requestRole"` keeps Rebase's own policies from applying to
  sessions that are not Rebase requests, such as Supabase's Data API.

Because requests run as `anon` and `authenticated` themselves, policies
written `TO anon` or `TO authenticated` apply as they are, and `inheritRoles`
is not needed. It is for a project whose requests run as a role of its own,
such as `requestRole: "acme_user", inheritRoles: ["authenticated"]`. With an
`{ anonymous, signedIn }` pair it is granted to the signed-in role only, never
to the anonymous one.

Supabase's stock default privileges have granted tables created in `public` to
`anon` and `authenticated`; check your project's. Run `rebase doctor --database`
and `rls-check` after the first boot to see what those roles can reach.

### A database administrator creates the roles

When the connection may not create roles, or roles live in Terraform:

```bash
REBASE_RLS_PROVISION_ROLE=never
```

Boot then checks the role and the membership and fails with the SQL to run,
instead of trying to create them. To hand that SQL to the administrator
beforehand:

```bash
rebase db provision --print > request-role.sql
```

It prints, for each request role, the statements that create it
(`NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`), give the connection role the
right to switch to it (`WITH SET TRUE, INHERIT FALSE` on PostgreSQL 16 and
newer), and grant it the schemas under `grants: "schema"`. The explanation is
written as SQL comments, so the file can be run as it is. It reads the
connection role from the database and runs nothing else. Every statement is
safe to run again.

### A shared `public` schema

When `public` holds tables Rebase should not reach:

```bash
REBASE_RLS_GRANTS=managed
```

Rebase then grants the request role only the tables it serves: collection
tables, junction tables, and its own row-secured tables. It sets no default
privileges in shared schemas and revokes nothing already granted.
`rebase doctor --database` lists the tables in Rebase's schemas that back no
collection.

Another way out is a schema of Rebase's own: set `schema` on each collection.

## Providers

What the connection role can do differs between providers, and decides
whether Rebase can create the request role itself. The notes below are what
we expect; check them with your provider.

| Provider | Usual connection role | Notes |
|---|---|---|
| Supabase | `postgres` (not a superuser, has CREATEROLE) | One database per project. `anon`, `authenticated` and `authenticator` exist, with default privileges in `public`. See the Supabase recipe above. |
| Neon | the project owner, a member of `neon_superuser` | Roles belong to a branch, and every database on a branch shares them. Two Rebase databases in one Neon project share `rebase_user`, so set `requestRole` per database. |
| AWS RDS / Aurora | the master user, a member of `rds_superuser` | Has CREATEROLE but is not a superuser. Instances are often shared between apps. |
| Google Cloud SQL | `postgres`, a member of `cloudsqlsuperuser` | As RDS. |
| Azure Flexible Server | the admin user, a member of `azure_pg_admin` | As RDS. |
| InstaPods | `instapod`; superuser through `sudo -u postgres` | [The InstaPods guide](/docs/deployment/instapods/) creates the role beforehand. |
| Hostman | `gen_user`; CREATE ROLE granted from the panel | Not available on the smallest tier. [The Hostman guide](/docs/deployment/hostman/) creates the role beforehand. |

## Related

- [Database Commands](/docs/cli/database/): `rebase db request-role` and
  `rebase db provision`
- [CLI reference](/docs/cli/#rebase-doctor): `rebase doctor --database`
- [rls-check](/docs/rls-check/): audit the policies on any Postgres
- [Security Rules (RLS)](/docs/collections/security-rules/): the policies
  Rebase writes for each collection
