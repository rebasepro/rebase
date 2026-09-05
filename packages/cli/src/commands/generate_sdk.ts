/**
 * CLI command: generate-sdk
 *
 * Reads collection definitions from a specified directory (default: ./config/collections),
 * generates a typed TypeScript SDK, and writes it to the output directory (default: ./generated/sdk).
 *
 * Uses jiti for dynamic TypeScript import of collection files.
 */

import fs from "fs";
import path from "path";
import chalk from "chalk";
import { CollectionConfig, computeSchemaVersion, deserializeCollections } from "@rebasepro/types";
import { CodegenError, generateSDK, GeneratedFile, toSafeIdentifier } from "@rebasepro/codegen";
import { detectPackageManager, getPMCommands } from "../utils/package-manager";
import { findProjectRoot } from "../utils/project";
import { readLink } from "./cloud/context";

interface GenerateSDKArgs {
    collectionsDir: string;
    output: string;
    cwd: string;
    /**
     * Where to read the schema from instead of local source.
     *
     * `link` uses this checkout's linked project; anything else is treated as
     * the base URL of a Rebase backend. This is what lets a repository that
     * contains no collections — a separate frontend, a second web app — generate
     * a typed client from the project it talks to.
     */
    from?: string;
    /** Bearer token for the contract endpoint. Falls back to REBASE_SERVICE_KEY. */
    token?: string;
    help?: boolean;
}

/**
 * Dynamically load collection definitions from a directory.
 *
 * Expects the directory to have an index.ts/index.js that exports a default
 * array of CollectionConfig objects (matching the app/config/collections pattern).
 */
async function loadCollections(collectionsDir: string): Promise<CollectionConfig[]> {
    const absDir = path.resolve(collectionsDir);

    if (!fs.existsSync(absDir)) {
        throw new Error(`Collections directory not found: ${absDir}`);
    }

    // Try to import the index file using jiti (supports TypeScript natively)
    let jiti: (id: string, userOptions?: Record<string, unknown>) => (modulePath: string) => Record<string, unknown>;
    try {
        const jitiModule = await import("jiti");
        jiti = (jitiModule.default || jitiModule) as typeof jiti;
    } catch {
        const installCmd = [...getPMCommands(detectPackageManager()).install, "-D", "jiti"].join(" ");
        throw new Error(
            `Could not load 'jiti'. Install it with: ${installCmd}\n` +
            "jiti is required to dynamically import TypeScript collection definitions."
        );
    }

    const jitiInstance = jiti(absDir, {
        interopDefault: true,
        esmResolve: true
    });

    // Look for index file
    const indexCandidates = ["index.ts", "index.js", "index.mjs"];
    let indexPath: string | null = null;

    for (const candidate of indexCandidates) {
        const p = path.join(absDir, candidate);
        if (fs.existsSync(p)) {
            indexPath = p;
            break;
        }
    }

    if (!indexPath) {
        // Fallback: load each .ts/.js file individually
        console.log(chalk.yellow("  No index file found, scanning individual collection files..."));
        const collections: CollectionConfig[] = [];
        const files = fs.readdirSync(absDir).filter(f =>
            (f.endsWith(".ts") || f.endsWith(".js")) && !f.startsWith(".")
        );

        for (const file of files) {
            try {
                const mod = jitiInstance(path.join(absDir, file));
                const exported = mod.default || mod;
                if (exported && typeof exported === "object" && "slug" in exported) {
                    collections.push(exported as CollectionConfig);
                } else if (Array.isArray(exported)) {
                    collections.push(...exported);
                }
            } catch (err) {
                console.warn(chalk.yellow(`  ⚠ Skipping ${file}: ${(err as Error).message}`));
            }
        }

        return collections;
    }

    // Import the index
    const mod = jitiInstance(indexPath);
    const exported = mod.default || mod;

    if (Array.isArray(exported)) {
        return exported as CollectionConfig[];
    } else if (typeof exported === "object" && exported !== null) {
        // Could be a named export like { collections: [...] }
        if ("collections" in exported && Array.isArray(exported.collections)) {
            return exported.collections;
        }
        // Or individual named exports
        const collections: CollectionConfig[] = [];
        for (const value of Object.values(exported)) {
            if (value && typeof value === "object" && "slug" in (value as CollectionConfig)) {
                collections.push(value as CollectionConfig);
            }
        }
        if (collections.length > 0) return collections;
    }

    throw new Error(
        `Could not extract collections from ${indexPath}.\n` +
        "Expected a default export of CollectionConfig[] or an object with named collection exports."
    );
}

/**
 * Write generated files to the output directory.
 */
function writeFiles(outputDir: string, files: GeneratedFile[]): void {
    const absOutput = path.resolve(outputDir);

    // Create output directory
    fs.mkdirSync(absOutput, { recursive: true });

    for (const file of files) {
        const filePath = path.join(absOutput, file.path);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, file.content, "utf-8");
    }
}

function printSdkHelp(): void {
    console.log(`
${chalk.bold("rebase generate-sdk")} — generate a typed client from a project's schema

${chalk.bold("Usage")}
  rebase generate-sdk [options]

${chalk.bold("Options")}
  -c, --collections-dir <dir>  Local collections directory (default: ./config/collections)
  -o, --output <dir>           Where to write the SDK (default: ./generated/sdk)
                               (--out is accepted too, as on 'rebase build')
      --from <link|url>        Fetch the schema from a running project instead of
                               local source. "link" uses this checkout's linked project.
      --token <token>          Bearer token for the contract endpoint
                               (default: $REBASE_SERVICE_KEY)
  -h, --help                   Show this help

${chalk.bold("Examples")}
  rebase generate-sdk                              From local collections
  rebase generate-sdk --from link                  From the linked project
  rebase generate-sdk --from https://api.acme.com  From any Rebase backend
`.trim());
}

/**
 * Fetch collections from a running project's contract endpoint.
 *
 * The payload replaces relation `target` functions with slug references, so it
 * has to be rehydrated before the generator sees it — the generator *calls*
 * `target()` to decide whether a foreign key is a string or a number, and a
 * missing target silently degrades that to a union rather than failing.
 */
async function fetchRemoteCollections(
    baseUrl: string,
    token: string | undefined
): Promise<{ collections: CollectionConfig[]; schemaVersion: string }> {
    const url = `${baseUrl.replace(/\/+$/, "")}/api/meta/contract`;

    const headers: Record<string, string> = { accept: "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;

    let response: Response;
    try {
        response = await fetch(url, { headers });
    } catch (err) {
        console.log(chalk.red(`  ✗ Could not reach ${url}`));
        console.log(chalk.gray(`    ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
    }

    if (response.status === 401 || response.status === 403) {
        console.log(chalk.red(`  ✗ Not authorized to read the project contract (${response.status}).`));
        console.log(chalk.gray("    The contract describes every table and relation, so it is admin-only."));
        console.log(chalk.gray("    Pass --token, or set REBASE_SERVICE_KEY."));
        process.exit(1);
    }

    if (response.status === 404) {
        console.log(chalk.red("  ✗ This server has no contract endpoint."));
        console.log(chalk.gray("    It needs to be running Rebase 0.11 or newer."));
        process.exit(1);
    }

    if (!response.ok) {
        console.log(chalk.red(`  ✗ Contract request failed with ${response.status}.`));
        process.exit(1);
    }

    const contract = await response.json() as {
        collections?: unknown[];
        schemaVersion?: string;
    };

    if (!Array.isArray(contract.collections)) {
        console.log(chalk.red("  ✗ The contract response did not contain collections."));
        process.exit(1);
    }

    return {
        collections: deserializeCollections(contract.collections),
        schemaVersion: contract.schemaVersion ?? "unknown"
    };
}

/**
 * Decide whether the ambient service key may be sent to this host.
 *
 * `REBASE_SERVICE_KEY` grants full admin bypass. Attaching it to whatever URL
 * happened to be passed — or, worse, to whatever a committed `.rebase/cloud.json`
 * points at — would hand the project's most powerful credential to a host nobody
 * vetted. An explicit `--token` is a decision the caller made; the ambient
 * variable is not, so it only travels to the project this checkout is linked to.
 */
function mayUseAmbientKey(target: string, cwd: string): boolean {
    const link = readLink(findProjectRoot(cwd) ?? cwd);
    if (!link?.apiUrl) return false;
    try {
        // Origin, not host: with a link recorded as https, an `http://` target
        // for the same host would otherwise pass and send the key in cleartext.
        return new URL(link.apiUrl).origin === new URL(target).origin;
    } catch {
        return false;
    }
}

/**
 * The base URL to show in the printed usage example.
 *
 * `rebase dev` binds a port derived from the project path, not 3001, and writes
 * the one it actually got to `.rebase/state.json`. Printing a hardcoded
 * `localhost:3001` sent people to a port nothing was listening on — or, with
 * several projects on one machine, to a different project's backend. Prefer the
 * port this project last ran on; fall back to the literal only when the project
 * has never been started.
 */
export function resolveExampleBaseUrl(cwd: string): string {
    const projectRoot = findProjectRoot(cwd) ?? cwd;
    try {
        const state = JSON.parse(fs.readFileSync(path.join(projectRoot, ".rebase", "state.json"), "utf-8"));
        if (typeof state.baseUrl === "string" && state.baseUrl) return state.baseUrl;
        if (typeof state.port === "number") return `http://localhost:${state.port}`;
    } catch {
        // Never started, or the file is unreadable — fall through.
    }
    return "http://localhost:3001";
}

/** Whether a slug can be written as `rebase.data.<slug>` rather than a lookup. */
export function isIdentifierLike(slug: string): boolean {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(slug);
}

/** Resolve `--from` into a base URL, following the link file when asked. */
function resolveSchemaSource(from: string, cwd: string): string {
    if (from !== "link") {
        // A bare hostname or a typo would otherwise be handed to `fetch` and fail
        // with something unhelpful; a non-http scheme has no business here at all.
        let parsed: URL;
        try {
            parsed = new URL(from);
        } catch {
            console.log(chalk.red(`  ✗ "${from}" is not a valid URL.`));
            console.log(chalk.gray("    Pass a full URL, e.g. https://api.example.com, or \"link\"."));
            process.exit(1);
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            console.log(chalk.red("  ✗ The project URL must be http or https."));
            process.exit(1);
        }
        return from;
    }

    const projectRoot = findProjectRoot(cwd) ?? cwd;
    const link = readLink(projectRoot);

    if (!link) {
        console.log(chalk.red("  ✗ This checkout is not linked to a project."));
        console.log(chalk.gray("    Run `rebase cloud link <url>`, or pass --from <url>."));
        process.exit(1);
    }

    const apiUrl = link.apiUrl;
    if (!apiUrl) {
        console.log(chalk.red("  ✗ The project link has no API URL."));
        console.log(chalk.gray("    Re-link with `rebase cloud link <url>` to record one."));
        process.exit(1);
    }

    return apiUrl;
}

/**
 * Main entry point for the generate-sdk command.
 */
export async function generateSdkCommand(args: GenerateSDKArgs): Promise<void> {
    const { collectionsDir, output, cwd } = args;

    if (args.help) {
        printSdkHelp();
        return;
    }

    const resolvedCollectionsDir = path.isAbsolute(collectionsDir)
        ? collectionsDir
        : path.join(cwd, collectionsDir);

    const resolvedOutput = path.isAbsolute(output)
        ? output
        : path.join(cwd, output);

    console.log("");
    console.log(chalk.bold("  🔧 Rebase SDK Generator"));
    console.log("");

    let collections: CollectionConfig[];
    let remoteSchemaVersion: string | undefined;

    if (args.from) {
        const baseUrl = resolveSchemaSource(args.from, cwd);
        console.log(`  ${chalk.gray("Project:")}     ${baseUrl}`);
        console.log(`  ${chalk.gray("Output:")}      ${resolvedOutput}`);
        console.log("");
        console.log(chalk.cyan("  → Fetching the project contract..."));

        const ambient = mayUseAmbientKey(baseUrl, cwd)
            ? process.env.REBASE_SERVICE_KEY
            : undefined;

        if (!args.token && !ambient && process.env.REBASE_SERVICE_KEY) {
            console.log(chalk.dim(
                "  (not sending REBASE_SERVICE_KEY — this host is not the linked project; pass --token to override)"
            ));
        }

        const remote = await fetchRemoteCollections(baseUrl, args.token || ambient);
        collections = remote.collections;
        remoteSchemaVersion = remote.schemaVersion;
    } else {
        console.log(`  ${chalk.gray("Collections:")} ${resolvedCollectionsDir}`);
        console.log(`  ${chalk.gray("Output:")}      ${resolvedOutput}`);
        console.log("");
        console.log(chalk.cyan("  → Loading collection definitions..."));
        collections = await loadCollections(resolvedCollectionsDir);
    }

    // Sort collections alphabetically by slug to ensure deterministic SDK generation
    collections.sort((a, b) => a.slug.localeCompare(b.slug));

    if (collections.length === 0) {
        console.log(chalk.red("  ✗ No collections found. Nothing to generate."));
        process.exit(1);
    }

    console.log(chalk.green(`  ✓ Found ${collections.length} collection(s): ${collections.map(c => c.slug).join(", ")}`));
    console.log("");

    // 2. Generate SDK files
    console.log(chalk.cyan("  → Generating SDK files..."));
    let files: GeneratedFile[];
    try {
        files = generateSDK(collections);
    } catch (err) {
        // A schema that cannot be expressed as valid TypeScript — two slugs
        // that collide on one accessor, a slug with no usable name. The
        // generator refuses rather than emitting a file that does not compile,
        // or one that silently routes a collection's reads to another's table.
        if (err instanceof CodegenError) {
            console.log("");
            console.log(chalk.red(`  ✗ ${err.message}`));
            process.exit(1);
        }
        throw err;
    }

    // Stamp the schema this SDK was built from.
    //
    // Without it, an app in a separate repository has no way to know its client
    // is stale: the backend moves on, the frontend keeps compiling against types
    // captured weeks ago, and the mismatch only surfaces as a runtime error. With
    // it, CI can compare against `/api/meta/schema-version` and say so.
    //
    // No generation timestamp. Collections are sorted above precisely so that
    // the same schema produces the same bytes; a timestamp put that back,
    // turning every regeneration into a diff and making the obvious staleness
    // gate — `rebase generate-sdk && git diff --exit-code` — impossible to pass.
    // `SCHEMA_VERSION` already identifies what this was built from, and does it
    // in a way that can be compared against a running project.
    const schemaVersion = remoteSchemaVersion ?? computeSchemaVersion(collections);
    files.push({
        path: "schema.meta.ts",
        content: `// Auto-generated by \`rebase generate-sdk\`. Do not edit.
//
// The schema version this SDK was generated from. Compare it against the
// project's current version to detect drift:
//
//     curl -s <api-url>/api/meta/schema-version
//
export const SCHEMA_VERSION = ${JSON.stringify(schemaVersion)};
`
    });

    console.log(chalk.green(`  ✓ Generated ${files.length} file(s)`));
    console.log(chalk.gray(`    schema ${schemaVersion}`));

    // 3. Write to disk
    console.log(chalk.cyan(`  → Writing to ${resolvedOutput}...`));
    writeFiles(resolvedOutput, files);

    console.log("");
    console.log(chalk.green.bold("  ✓ SDK generated successfully!"));
    console.log("");
    const typesImport = `./${path.relative(cwd, path.join(resolvedOutput, "database.types"))}`;
    const exampleSlug = collections[0]?.slug || "my_collection";

    console.log(chalk.gray("  Usage:"));
    console.log(chalk.gray("    import { createRebaseClient } from '@rebasepro/client';"));
    console.log(chalk.gray(`    import { collectionsDictionary, type Database } from '${typesImport}';`));
    console.log("");
    console.log(chalk.gray("    const rebase = createRebaseClient<Database>({"));
    console.log(chalk.gray(`        baseUrl: '${resolveExampleBaseUrl(cwd)}',`));
    // Without the dictionary a hyphenated slug is not resolvable from the
    // property name alone, and the request 404s at runtime.
    console.log(chalk.gray("        collections: collectionsDictionary,"));
    console.log(chalk.gray("        // token: 'your-jwt-token',"));
    console.log(chalk.gray("    });"));
    console.log("");
    // `rebase.data.<accessor>` is the typed surface, so it is what gets printed.
    // `rebase.data.collection(slug)` exists too, but it is generic over
    // `Record<string, unknown>` and has no link to `Database` — it was the
    // headline example here for a while, which advertised the one call shape
    // that throws away the types this command just generated.
    const exampleAccessor = toSafeIdentifier(exampleSlug);
    const exampleAccess = isIdentifierLike(exampleAccessor)
        ? `rebase.data.${exampleAccessor}`
        : `rebase.data[${JSON.stringify(exampleAccessor)}]`;
    console.log(chalk.gray(`    const { data } = await ${exampleAccess}.find();`));
    console.log("");
}
