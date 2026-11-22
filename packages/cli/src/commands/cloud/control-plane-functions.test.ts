/**
 * Every control-plane function the cloud family calls, held to a checked-in
 * list of which the control plane serves.
 *
 * The CLI and the control plane ship apart. A command can be written, tested
 * against a fake client and released while the function it calls lives only on
 * a control-plane branch nobody has merged — seven of them did, and on the
 * production control plane each answered a bare "Not found" that read as a
 * missing project. So the list below says, per function, `served` or which
 * branch it is pending on, and:
 *
 *  - the list and the functions the source calls must match exactly, so a new
 *    call is a decision recorded here rather than an assumption;
 *  - a command calling a pending function must answer `not_served` (it imports
 *    the helper that does);
 *  - when the control plane's source sits beside this repository (`saas/` at
 *    the monorepo root), a `served` function must have its file there and a
 *    pending one must not — so the entry is updated on the day its branch
 *    lands. Without `saas/`, that half is skipped.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `served` on saas `main`; `pending` on the named saas branch; `removed` from
 * saas `main` by the named commit, and called only where a failure is
 * swallowed (the line it decorates is left out).
 */
type Status = "served" | { pending: string } | { removed: string };

/**
 * Each function the cloud family invokes, and whether the control plane on
 * saas `main` serves it. A pending entry names the saas branch it lives on.
 */
const CONTROL_PLANE_FUNCTIONS: Record<string, Status> = {
    alerts: "served",
    backup: "served",
    "check-subdomain": "served",
    "cluster-baseline": "served",
    "db-info": "served",
    "db-test": "served",
    deploy: "served",
    domains: "served",
    "env-vars": "served",
    ephemeral: "served",
    extensions: "served",
    // `orgs members invite` on a control plane without `invites`: resolves an
    // address to an account, as the console's "Add member" does.
    "invite-by-email": "served",
    "linked-instances": "served",
    metrics: "served",
    "platform-config": "served",
    previews: "served",
    pricing: "served",
    resources: "served",
    "runtime-logs": "served",
    "runtime-token": "served",
    sleep: "served",
    "storage-provision": "served",
    "stripe-billing": "served",
    studio: "served",
    "verify-domain": "served",

    // `projects info` reads it for a "Storage" line and drops the line when
    // it fails, which it now always does.
    capacity: { removed: "2ec7a80 Delete the shared database tier" },

    audit: { pending: "sweep/2026-10-24" },
    credentials: { pending: "sweep/2026-10-24" },
    invites: { pending: "sweep/2026-10-24" },
    // `rebase cloud access`: project roles, built with saas `functions/project-access.ts`.
    "project-access": { pending: "feat/cloud-seam" },
    notifications: { pending: "sweep/2026-10-24" },
    usage: { pending: "sweep/2026-10-24" },
    "db-access": { pending: "feat/db-external-access" },
    maintenance: { pending: "feat/db-scaling" },
    "project-transfer": { pending: "claude/project-transfer-between-orgs-6f3564" }
};

/**
 * Routes the CLI calls on a function that IS served, which that function does
 * not have yet. `route` is the path the function's own Hono app would declare.
 */
const PENDING_ROUTES: Array<{ fn: string; route: string; pending: string }> = [
    { fn: "stripe-billing", route: "/invoices/", pending: "sweep/2026-10-24" },
    { fn: "stripe-billing", route: "/upcoming/", pending: "sweep/2026-10-24" }
];

const CLOUD_DIR = __dirname;
const MONOREPO_ROOT = path.resolve(__dirname, "../../../../..");
const SAAS_FUNCTIONS = path.join(MONOREPO_ROOT, "saas", "backend", "functions");
const HAS_SAAS = fs.existsSync(SAAS_FUNCTIONS);

/** A source file with its comment lines removed: a docblock naming a route is not a call to it. */
function code(source: string): string {
    return source
        .split("\n")
        .filter(line => !/^\s*(\/\/|\/\*|\*)/.test(line))
        .join("\n");
}

/** Every non-test module of the cloud family, by file name. */
function sources(): Map<string, string> {
    const out = new Map<string, string>();
    for (const file of fs.readdirSync(CLOUD_DIR)) {
        if (!file.endsWith(".ts") || file.includes(".test.")) continue;
        out.set(file, code(fs.readFileSync(path.join(CLOUD_DIR, file), "utf8")));
    }
    return out;
}

/** `const NAME = "value"` across the family: the functions some modules name by constant. */
function constants(all: Map<string, string>): Map<string, string> {
    const out = new Map<string, string>();
    for (const source of all.values()) {
        for (const m of source.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*(?::\s*string\s*)?=\s*"([a-z][a-z0-9-]*)"/g)) {
            out.set(m[1], m[2]);
        }
    }
    return out;
}

interface Calls {
    /** Function name → the files that call it. */
    byName: Map<string, Set<string>>;
    /** `.invoke(` sites whose function could not be read, as `file: excerpt`. */
    unresolved: string[];
}

/**
 * The functions each file calls: through `functions.invoke("<name>"` (or a
 * constant holding the name), and through a literal `/api/functions/<name>`
 * that a raw `fetch` uses.
 */
function calls(): Calls {
    const all = sources();
    const consts = constants(all);
    const byName = new Map<string, Set<string>>();
    const unresolved: string[] = [];
    const add = (name: string, file: string) => {
        if (!byName.has(name)) byName.set(name, new Set());
        byName.get(name)!.add(file);
    };
    for (const [file, source] of all) {
        // The generic argument may span lines and nest braces; the first `(`
        // after it opens the argument list.
        const invokes = [...source.matchAll(/\.invoke\b/g)].length;
        let resolved = 0;
        for (const m of source.matchAll(/\.invoke\b(?:\s*<[\s\S]{0,400}?>)?\(\s*(?:"([a-z][a-z0-9-]*)"|([A-Z][A-Z0-9_]*)\b)/g)) {
            const name = m[1] ?? consts.get(m[2] ?? "");
            if (name) {
                add(name, file);
                resolved++;
            } else {
                unresolved.push(`${file}: ${m[0].slice(0, 60)}`);
            }
        }
        if (resolved < invokes && unresolved.every(u => !u.startsWith(`${file}:`))) {
            unresolved.push(`${file}: ${invokes - resolved} .invoke call(s) whose function name is not a literal or a constant`);
        }
        for (const m of source.matchAll(/\/api\/functions\/([a-z][a-z0-9-]*)/g)) add(m[1], file);
    }
    return { byName, unresolved };
}

describe("control-plane functions the cloud family calls", () => {
    const { byName, unresolved } = calls();

    it("finds the calls it is checking, so an empty sweep cannot pass", () => {
        expect(byName.size).toBeGreaterThan(20);
        expect(byName.get("deploy")?.size).toBeGreaterThan(1);
        expect(byName.has("credentials")).toBe(true);
    });

    it("reads every call's function name", () => {
        expect(unresolved, "a call this test cannot read is a call nobody checks against the control plane").toEqual([]);
    });

    it("lists every function called, and nothing that is not", () => {
        expect([...byName.keys()].sort(), "add the new function to CONTROL_PLANE_FUNCTIONS: served, or the saas branch it is pending on")
            .toEqual(Object.keys(CONTROL_PLANE_FUNCTIONS).sort());
    });

    it("answers not_served from every command that calls a pending function", () => {
        const missing: string[] = [];
        const all = sources();
        for (const [name, status] of Object.entries(CONTROL_PLANE_FUNCTIONS)) {
            if (status === "served" || "removed" in status) continue;
            for (const file of byName.get(name) ?? []) {
                if (!all.get(file)?.includes('from "./not-served"')) missing.push(`${file} calls ${name}`);
            }
        }
        expect(missing, "a pending function answers 404 on today's control plane; say so with not-served.ts").toEqual([]);
    });

    it("still calls the pending routes it lists", () => {
        const all = [...sources().values()].join("\n");
        for (const { route } of PENDING_ROUTES) {
            expect(all, `no call to ${route} any more: drop it from PENDING_ROUTES`).toContain(`\`${route.slice(1)}`);
        }
    });

    describe.runIf(HAS_SAAS)("against the control plane's source beside this repository", () => {
        it.each(Object.entries(CONTROL_PLANE_FUNCTIONS))("%s is where the list says", (name, status) => {
            const present = fs.existsSync(path.join(SAAS_FUNCTIONS, `${name}.ts`));
            if (status === "served") {
                expect(present, `${name} is listed as served, and saas/backend/functions/${name}.ts does not exist`).toBe(true);
            } else if ("removed" in status) {
                expect(present, `${name} is back in saas (removed in ${status.removed}): mark it served`).toBe(false);
            } else {
                expect(
                    present,
                    `${name} has landed in saas (it was pending on ${status.pending}): mark it served in CONTROL_PLANE_FUNCTIONS`
                ).toBe(false);
            }
        });

        it.each(PENDING_ROUTES.map(r => [`${r.fn} ${r.route}`, r] as const))("%s is still pending", (_label, r) => {
            const file = path.join(SAAS_FUNCTIONS, `${r.fn}.ts`);
            expect(fs.existsSync(file), `${r.fn} should be served`).toBe(true);
            const source = fs.readFileSync(file, "utf8");
            const declared = new RegExp(`\\.(get|post|put|patch|delete)\\(\\s*"${r.route.replace(/[/]/g, "\\/")}`).test(source);
            expect(
                declared,
                `${r.fn} now serves ${r.route} (it was pending on ${r.pending}): drop it from PENDING_ROUTES`
            ).toBe(false);
        });
    });
});
