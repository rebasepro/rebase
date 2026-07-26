import type { Check, DbSnapshot, Finding } from "../types";

import { finding } from "./util";

const ID = "security-definer-mutable-search-path";

/**
 * A SECURITY DEFINER routine whose `search_path` is not pinned.
 *
 * The routine executes as its owner — frequently a superuser or the schema owner
 * — while the *caller* decides what `public.some_table` or `now()` resolves to.
 * Anyone who can create objects in a schema on the caller's search_path can put
 * a shadowing function or table in front of one the routine uses, and it runs
 * with the owner's privileges. That includes reading and writing tables whose
 * RLS policies would otherwise have applied.
 *
 * This one is `certain`: it is a property of the catalog, not an inference.
 * Whether it is exploitable depends on who can create objects, which is why the
 * impact line says so rather than claiming a working escalation.
 */
export const securityDefinerMutableSearchPath: Check = {
    id: ID,
    title: "SECURITY DEFINER routine with a mutable search_path",
    description:
        "A SECURITY DEFINER function or procedure that does not pin search_path, so the caller " +
        "controls how its identifiers resolve.",

    run(snapshot: DbSnapshot): Finding[] {
        const findings: Finding[] = [];

        for (const routine of snapshot.routines) {
            if (!snapshot.schemas.includes(routine.schema)) continue;
            if (!routine.securityDefiner || !routine.mutableSearchPath) continue;

            findings.push(
                finding({
                    id: ID,
                    severity: "medium",
                    confidence: "certain",
                    title:
                        `${routine.schema}.${routine.name} is SECURITY DEFINER and does not pin ` +
                        `search_path`,
                    target: { schema: routine.schema, routine: routine.name },
                    detail:
                        `This routine runs with the privileges of its owner (${routine.owner}) but ` +
                        `resolves unqualified names using the *caller's* search_path, because no ` +
                        `\`SET search_path\` is attached to it. A caller who can create objects in any ` +
                        `schema on that path can shadow a table or function the routine uses, and their ` +
                        `object then runs as ${routine.owner}.`,
                    impact:
                        `Any role that can both execute this routine and create objects in a schema on ` +
                        `its search_path can have arbitrary SQL run as ${routine.owner} — which bypasses ` +
                        `row-level security on every table ${routine.owner} can reach. Without CREATE on ` +
                        `some schema this is not directly exploitable, so check who holds CREATE ` +
                        `(commonly PUBLIC on \`public\` in older databases).`,
                    fix:
                        `-- Pin the search_path on every overload of this routine:\n` +
                        `DO $$\n` +
                        `DECLARE r record;\n` +
                        `BEGIN\n` +
                        `    FOR r IN\n` +
                        `        SELECT p.oid::regprocedure AS sig\n` +
                        `        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace\n` +
                        `        WHERE n.nspname = ${literal(routine.schema)} AND p.proname = ${literal(routine.name)}\n` +
                        `    LOOP\n` +
                        `        EXECUTE format('ALTER ROUTINE %s SET search_path = pg_catalog, pg_temp', r.sig);\n` +
                        `    END LOOP;\n` +
                        `END $$;\n` +
                        `-- Then schema-qualify every identifier in the body, since nothing but\n` +
                        `-- pg_catalog is on the path any more.`
                })
            );
        }

        return findings;
    }
};

const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;
