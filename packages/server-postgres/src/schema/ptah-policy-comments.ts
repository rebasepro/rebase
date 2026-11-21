import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

import { withAppClient } from "../cli-helpers";
import { DESIRED_STATE_URL, generatedSqlDir } from "../generated-sql";
import { planTablePolicies } from "./generate-postgres-ddl-logic";

interface PolicyComment {
    schema: string;
    table: string;
    name: string;
    comment: string | null;
}

const quoteIdent = (value: string): string => `"${value.replace(/"/g, '""')}"`;
const quoteLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;
const policyKey = (schema: string, table: string, name: string): string =>
    JSON.stringify([schema, table, name]);

/** Preserve only Rebase stamps on policies the current schema still declares. */
export function policyCommentStatements(
    plans: readonly { schema: string; table: string; policies: readonly { name: string }[] }[],
    rows: readonly PolicyComment[]
): string[] {
    const declared = new Set(plans.flatMap(plan =>
        plan.policies.map(policy => policyKey(plan.schema, plan.table, policy.name))
    ));
    return rows
        .filter(row => declared.has(policyKey(row.schema, row.table, row.name))
            && /^rebase:[0-9a-f]{64}$/.test(row.comment ?? ""))
        .map(row => `COMMENT ON POLICY ${quoteIdent(row.name)} ON ` +
            `${quoteIdent(row.schema)}.${quoteIdent(row.table)} IS ${quoteLiteral(row.comment ?? "")};`);
}

/**
 * Keep Rebase's live policy stamps in the schema apply input. The canonical
 * schema.sql stays independent of the target and is used by migrate diff.
 * Ptah otherwise plans COMMENT ON POLICY ... IS NULL on every repeat push,
 * and applying that plan erases the stamps boot uses to skip unchanged RLS.
 */
export async function ptahApplyDesiredStateUrl(databaseUrl: string, schemaDir: string): Promise<string> {
    const { loadTables } = await import("./load-tables");
    const plans = planTablePolicies(await loadTables(schemaDir));
    if (plans.length === 0) return DESIRED_STATE_URL;

    const schemas = [...new Set(plans.map(plan => plan.schema))];
    const result = await withAppClient(databaseUrl, client => client.query<PolicyComment>(
        `SELECT n.nspname AS schema, c.relname AS table, p.polname AS name,
                obj_description(p.oid, 'pg_policy') AS comment
         FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = ANY($1::text[])
         ORDER BY n.nspname, c.relname, p.polname`,
        [schemas]
    ));
    const comments = policyCommentStatements(plans, result.rows);
    if (comments.length === 0) return DESIRED_STATE_URL;

    const dir = generatedSqlDir();
    const file = path.join(dir, "schema-apply.sql");
    fs.writeFileSync(file, fs.readFileSync(path.join(dir, "schema.sql"), "utf8") +
        "\n" + comments.join("\n") + "\n");
    return pathToFileURL(file).href;
}
