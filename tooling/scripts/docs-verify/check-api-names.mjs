/**
 * Identifier-level API check across *every* locale.
 *
 * The snippet typechecker only runs on English, because the other five locales
 * are generated from it (website/scripts/translate_docs.mjs). But translation
 * copies code blocks verbatim, so a bad API name reaches all six — and a locale
 * can also drift on its own when a fix lands in English only. This stage is the
 * cheap net for that: no compiler program per locale, just two textual checks
 * against the real export surface.
 *
 *   1. Named imports from `@rebasepro/*` must actually be exported by it.
 *   2. Member access on a receiver with a known SDK type (`channel.x`,
 *      `client.x`) must exist on that type.
 *
 * Check 2 is what would have caught `channel.on("message")` /
 * `channel.send(...)` / `channel.presence.track(...)` in all six locales.
 */
import { readFileSync, existsSync, globSync } from "node:fs";
import path from "node:path";
import { loadSdkExports, PACKAGE_ENTRIES } from "./sdk-exports.mjs";
import { extractSnippets, AGENT_INSTRUCTION_GLOBS } from "./extract.mjs";

/** All locales, plus the skills — everything a reader might copy from. */
const ALL_DOC_GLOBS = [
    "website/src/content/docs/**/*.md",
    "website/src/content/docs/**/*.mdx",
    "tooling/rebase-agent-skills/**/*.md",
    // The example READMEs are documentation by every definition that matters,
    // and no glob in this repository covered them. One level deep on purpose:
    // every example has its own `node_modules` here, which a `**` glob walks.
    "examples/*/*.md",
    // …and so are the repo's own agent instructions. See AGENT_INSTRUCTION_GLOBS.
    ...AGENT_INSTRUCTION_GLOBS
];

/**
 * Receivers whose member access we can check by name alone. Keyed by the
 * variable name conventionally used in the docs.
 */
const TYPED_RECEIVERS = {
    channel: { pkg: "@rebasepro/client", type: "RebaseRealtimeChannel" }
};

/**
 * Members that exist at runtime but not as declared properties of the type
 * (e.g. reached through an index signature or a proxy). Listing them here keeps
 * the check honest rather than silently loosening it.
 */
const RECEIVER_ALLOWLIST = {
    channel: new Set()
};

/**
 * Subpath imports (`@rebasepro/server/services/webhook-service`) resolve fine
 * inside the monorepo, because tsconfig.typecheck.json maps `@rebasepro/x/*` to
 * source. For a reader who installed from npm they resolve only if the
 * package's `exports` map declares the subpath — otherwise the import throws
 * ERR_PACKAGE_PATH_NOT_EXPORTED. The snippet typechecker therefore cannot see
 * this class at all; it has to be checked against package.json.
 */
function buildExportMaps(root) {
    const maps = new Map();
    for (const [spec, entry] of Object.entries(PACKAGE_ENTRIES)) {
        // "packages/server/src/index.ts" → "packages/server"
        const dir = entry.replace(/\/src\/.*$/, "");
        const pkgJson = path.join(root, dir, "package.json");
        if (!existsSync(pkgJson)) continue;
        try {
            const exp = JSON.parse(readFileSync(pkgJson, "utf8")).exports;
            if (exp && typeof exp === "object") maps.set(spec, Object.keys(exp));
        } catch {
            /* unreadable package.json — skip rather than fail the run */
        }
    }
    return maps;
}

export async function checkApiNames(root) {
    const { byPackage, membersOf } = loadSdkExports(root);
    const { snippets, files } = extractSnippets(root, ALL_DOC_GLOBS);
    const exportMaps = buildExportMaps(root);

    const receiverMembers = new Map();
    for (const [name, { pkg, type }] of Object.entries(TYPED_RECEIVERS)) {
        const members = membersOf(pkg, type);
        if (members.size) receiverMembers.set(name, members);
    }

    /** @type {Map<string, { name: string, specifier: string, hint?: string, locations: string[] }>} */
    const unknown = new Map();
    const record = (key, name, specifier, location, hint) => {
        if (!unknown.has(key)) unknown.set(key, { name, specifier, hint, locations: [] });
        unknown.get(key).locations.push(location);
    };

    /** A wrong-package import is the common case; point at the right one. */
    const findOwner = (name) => {
        for (const [pkg, names] of byPackage) if (names.has(name)) return pkg;
        return undefined;
    };

    for (const s of snippets) {
        const lines = s.code.split("\n");

        // ── 1. Named imports from workspace packages ──
        // The optional trailing segment covers published subpaths that
        // PACKAGE_ENTRIES knows about — `@rebasepro/server/functions` is one.
        // A subpath it does not know about resolves to no export set and is
        // skipped, exactly as before.
        for (const m of s.code.matchAll(
            /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'](@rebasepro\/[^"'/]+(?:\/[^"'/]+)?)["']/g
        )) {
            const exported = byPackage.get(m[2]);
            if (!exported) continue; // package not in the graph — nothing to assert
            const at = s.line + s.code.slice(0, m.index).split("\n").length - 1;
            // Doc import lists are annotated (`Card, // Layout`) and sometimes
            // elided (`Button, ...`). Strip comments, then keep only tokens
            // that are actually identifiers.
            const clause = m[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
            for (const raw of clause.split(",")) {
                // `Foo as Bar` / `type Foo` — the imported name is the first token.
                const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
                if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
                if (exported.has(name)) continue;
                const owner = findOwner(name);
                record(
                    `${m[2]}#${name}`,
                    name,
                    m[2],
                    `${s.file}:${at}`,
                    owner ? `exported by ${owner} — wrong package?` : "not exported by any workspace package"
                );
            }
        }

        // ── 2. Subpath imports must be declared in the package's exports map ──
        for (const m of s.code.matchAll(
            /from\s*["'](@rebasepro\/([^"'/]+)\/[^"']+)["']/g
        )) {
            const spec = m[1];
            const pkg = `@rebasepro/${m[2]}`;
            const exportKeys = exportMaps.get(pkg);
            if (!exportKeys) continue;
            const subpath = `.${spec.slice(pkg.length)}`;
            const allowed = exportKeys.some((k) =>
                k.includes("*")
                    ? new RegExp(`^${k.replace(/\*/g, ".*")}$`).test(subpath)
                    : k === subpath
            );
            if (allowed) continue;
            const at = s.line + s.code.slice(0, m.index).split("\n").length - 1;
            record(
                `subpath:${spec}`,
                spec,
                `${pkg} package.json exports`,
                `${s.file}:${at}`,
                "resolves in-repo but not for an installed consumer (no such subpath export)"
            );
        }

        // ── 3. Member access on typed receivers ──
        for (const [receiver, members] of receiverMembers) {
            const allow = RECEIVER_ALLOWLIST[receiver] || new Set();
            const re = new RegExp(`\\b${receiver}\\.([A-Za-z_$][\\w$]*)`, "g");
            for (const m of s.code.matchAll(re)) {
                const prop = m[1];
                if (members.has(prop) || allow.has(prop)) continue;
                const at = s.line + s.code.slice(0, m.index).split("\n").length - 1;
                record(
                    `${receiver}.${prop}`,
                    `${receiver}.${prop}`,
                    `${TYPED_RECEIVERS[receiver].type} (${TYPED_RECEIVERS[receiver].pkg})`,
                    `${s.file}:${at}`
                );
            }
        }
        void lines;
    }

    return {
        unknown: [...unknown.values()].sort((a, b) => b.locations.length - a.locations.length),
        scanned: files,
        fences: snippets.length
    };
}
