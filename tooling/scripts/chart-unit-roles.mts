/**
 * What the runtime makes of each unit the chart renders — the role it boots as,
 * whether it provisions the collection schema — or the refusal it would boot
 * into instead.
 *
 * `check-chart.mjs` renders the chart and asserts on the manifests, which is
 * everything a renderer can see. It could not see that the migration Job it had
 * rendered since the chart existed was a process the runtime refused to start:
 * `REBASE_ROLE=worker` beside `REBASE_MIGRATE_ON_BOOT=ensure` is a refusal in
 * `resolveRole`, so every install stopped at its pre-install hook, and the
 * manifest was correct by every rule written down in the chart. The rules that
 * mattered were in the runtime.
 *
 * So the chart check hands each unit's env to this, and this answers with the
 * runtime's own code: the boot environment's schema, `resolveRole`,
 * `resolveProvisionOnly`. Nothing here restates a rule; what it adds is the one
 * line boot.ts applies on top of the role (`REBASE_PROVISION`, then
 * `REBASE_MIGRATE_ON_BOOT=none`), to say whether the collection schema is this
 * unit's to create.
 *
 * Input on stdin, output on stdout, both JSON:
 *
 *     [{ "unit": "rebase-rebase-migrate", "env": { "REBASE_ROLE": "all", … } }]
 *     [{ "unit": "rebase-rebase-migrate", "role": "all", "provisionOnly": true, "provisionsCollections": true }]
 *
 *     TSX_TSCONFIG_PATH=tsconfig.typecheck.json node --import tsx tooling/scripts/chart-unit-roles.mts < units.json
 */
import { bootEnvExtension } from "../../packages/server/src/boot/env";
import { resolveRole, RoleConfigurationError } from "../../packages/server/src/boot/role";
import { resolveProvisionOnly } from "../../packages/server/src/boot/provision-only";

interface UnitInput {
    unit: string;
    env: Record<string, string>;
}

type UnitVerdict =
    | { unit: string; refused: string }
    | { unit: string; role: string; provisionOnly: boolean; provisionsCollections: boolean };

function verdict({ unit, env }: UnitInput): UnitVerdict {
    // Only the variables the boot reads for its shape; a value the chart takes
    // from a Secret is not here, and none of them decides a role.
    const parsed = bootEnvExtension.safeParse(env);
    if (!parsed.success) {
        return { unit, refused: `the boot environment does not parse: ${parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
    }
    try {
        const role = resolveRole(parsed.data);
        const migrate = parsed.data.REBASE_MIGRATE_ON_BOOT || "ensure";
        return {
            unit,
            role: role.role,
            provisionOnly: resolveProvisionOnly(env),
            // As bootFromBundle decides it: nothing at all under
            // REBASE_PROVISION=false, the collection schema only for a role that
            // owns it, and not when REBASE_MIGRATE_ON_BOOT=none turns it off.
            provisionsCollections: parsed.data.REBASE_PROVISION && role.provisionSchema && migrate !== "none"
        };
    } catch (err) {
        if (err instanceof RoleConfigurationError) {
            return { unit, refused: `${err.message}${err.hint ? ` ${err.hint}` : ""}` };
        }
        throw err;
    }
}

function isUnitInput(value: unknown): value is UnitInput {
    if (typeof value !== "object" || value === null || !("unit" in value) || !("env" in value)) return false;
    const { unit, env } = value;
    return typeof unit === "string" && typeof env === "object" && env !== null
        && Object.values(env).every(v => typeof v === "string");
}

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
if (!Array.isArray(input) || !input.every(isUnitInput)) {
    throw new Error("chart-unit-roles: expected a JSON array of { unit, env } on stdin");
}
process.stdout.write(JSON.stringify(input.map(verdict)));
