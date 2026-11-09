/**
 * `tenant`'s immutability, as a database trigger.
 *
 * The driver refuses an update that moves a row to another tenant
 * (`TENANT_IMMUTABLE`, see `resolveTenantWrite` in `@rebasepro/common`), and
 * the restrictive tenant policy cannot: a policy sees the new row or the old
 * one, never both, so a caller who belongs to two tenants passes it while
 * moving a row from one to the other. Every writer that is not the driver —
 * SQL run as the caller (`DataDriver.sql`) above all — met only the policy.
 *
 * So a `BEFORE UPDATE` trigger compares the two. It applies to whoever the
 * table's policies bind (`row_security_active`), which is every request role
 * whatever `rls.requestRole` names it: the owner connection (migrations, the
 * auth flows, a person in `psql`) keeps moving rows when it means to, as it
 * always could, and so does a caller holding one of the collection's
 * `bypassRoles` — the same exemption the driver makes.
 *
 * One function for every table, the column and the bypass roles arriving as
 * trigger arguments, like `set_updated_at`. The arguments are compared with
 * the catalogue's on boot (see `diffPlanAgainstCatalogue`), so a changed
 * `bypassRoles` re-creates the binding rather than leaving the old list in
 * force.
 */
import { REBASE_SCHEMA } from "@rebasepro/types";
import type { TriggerPlan } from "./types";

/** The one trigger function, qualified. A frozen derived name. */
export const KEEP_TENANT_FN = `${REBASE_SCHEMA}.keep_tenant`;

/** The trigger's name on `table`. A frozen derived name. */
export const keepTenantTriggerName = (table: string): string => `${table}_keep_tenant`;

export const keepTenantFunction = (): string =>
    `CREATE OR REPLACE FUNCTION ${KEEP_TENANT_FN}() RETURNS trigger\n` +
    "LANGUAGE plpgsql AS $$\n" +
    "BEGIN\n" +
    // Nested rather than one AND, which Postgres may evaluate in any order;
    // and the roles read from the setting itself, as `rebase.roles()` does,
    // so the owner's updates never depend on that function existing yet.
    "    IF row_security_active(TG_RELID) THEN\n" +
    "        IF to_jsonb(OLD) -> TG_ARGV[0] IS DISTINCT FROM to_jsonb(NEW) -> TG_ARGV[0] THEN\n" +
    "            IF NOT (string_to_array(COALESCE(current_setting('app.user_roles', true), ''), ',') && TG_ARGV[1:TG_NARGS - 1]) THEN\n" +
    "                RAISE EXCEPTION 'TENANT_IMMUTABLE: an update cannot move a row of \"%\" to another tenant (column \"%\")', TG_TABLE_NAME, TG_ARGV[0]\n" +
    "                    USING ERRCODE = '42501',\n" +
    "                          HINT = 'Move it as a role listed in the collection''s tenant.bypassRoles.';\n" +
    "            END IF;\n" +
    "        END IF;\n" +
    "    END IF;\n" +
    "    RETURN NEW;\n" +
    "END;\n" +
    "$$;";

/** The arguments the binding passes: the column, then each bypass role. */
export const keepTenantArguments = (plan: TriggerPlan): string[] => [plan.column, ...(plan.bypassRoles ?? [])];

const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export const createKeepTenantStatement = (plan: TriggerPlan): string =>
    `CREATE TRIGGER "${plan.name}" BEFORE UPDATE ON "${plan.schema}"."${plan.table}" ` +
    `FOR EACH ROW EXECUTE FUNCTION ${KEEP_TENANT_FN}(${keepTenantArguments(plan).map(literal).join(", ")});`;
