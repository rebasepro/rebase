/**
 * A published driver must not carry its own copy of a runtime-provided package.
 *
 * `@rebasepro/server-postgres` is built by vite with most of its dependencies
 * INLINED, so that a linked consumer works without installing them. For
 * `@rebasepro/types` that was quietly fatal. The kind registry it exports is
 * process-global by design — two copies of the package must see one graph — so
 * a pod holding the image's copy AND the copy frozen inside the bundle's driver
 * had both of them registering the same kinds into shared state.
 *
 * Whichever copy registers SECOND runs the comparison, and the second is always
 * the driver's, because a driver is imported after the runtime. So the rule
 * applied is the rule that shipped with the bundle, however old. 0.17.0–0.17.3
 * deep-equal the spec and throw `Resource kind "database" is already registered
 * with a different definition`; no change to the current package can alter what
 * a copy already in the field does. Two tenants crash-looped for six and a half
 * days on this, and the 0.18.0 release was stopped by the bundle corpus for it.
 *
 * The registration protocol is versioned now so a collision cannot throw. This
 * gate is the other half: the duplication itself is what nobody should be able
 * to reintroduce, because every fix downstream of it is a fix to a symptom.
 *
 * Run against `dist`, not against source, because the question is what the
 * TARBALL carries — a vite config that looks right and a build that inlines
 * anyway is exactly the failure mode.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Packages the image supplies, which a driver must therefore import rather than
 * embed. Read from the CLI's own list so the two cannot drift: a package added
 * to RUNTIME_PROVIDED is one this gate starts covering on the same commit.
 */
function runtimeProvidedScoped() {
    const src = readFileSync(path.join(ROOT, "packages/cli/src/bundle.ts"), "utf8");
    const block = src.match(/const RUNTIME_PROVIDED = new Set\(\[([\s\S]*?)\]\)/);
    assert.ok(block, "RUNTIME_PROVIDED not found in packages/cli/src/bundle.ts");
    return [...block[1].matchAll(/"(@rebasepro\/[^"]+)"/g)].map(m => m[1]);
}

/** Every built .js file in a package's dist. */
function distFiles(pkg) {
    const dir = path.join(ROOT, "packages", pkg, "dist");
    if (!existsSync(dir)) return [];
    const out = [];
    const walk = d => {
        for (const entry of readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".js")) out.push(full);
        }
    };
    walk(dir);
    return out;
}

/**
 * A marker that is unmistakably the registry's own source rather than a mention
 * of it: the global symbol key. If this string is in a driver's dist, the
 * driver defines the registry instead of importing it.
 */
const REGISTRY_MARKERS = [
    '"@rebasepro/types.resourceRegistry"',
    '"@rebasepro/types.resourceKinds'
];

const DRIVERS = ["server-postgres", "server-mongo"];

for (const driver of DRIVERS) {
    const files = distFiles(driver);

    test(`${driver}: dist is built (otherwise this gate proves nothing)`, () => {
        assert.ok(
            files.length > 0,
            `packages/${driver}/dist has no .js files — run \`pnpm build\` before \`pnpm test:gates\`.`
        );
    });

    if (files.length === 0) continue;

    test(`${driver}: does not inline the resource-kind registry`, () => {
        const offenders = files.filter(f => {
            const text = readFileSync(f, "utf8");
            return REGISTRY_MARKERS.some(marker => text.includes(marker));
        });
        assert.deepEqual(
            offenders.map(f => path.relative(ROOT, f)),
            [],
            `These built files define the resource-kind registry instead of importing it. ` +
            `A pod running this driver beside the runtime image holds two copies, and the ` +
            `older one decides what happens when they disagree. Externalize @rebasepro/types ` +
            `in packages/${driver}/vite.config.ts.`
        );
    });

    test(`${driver}: imports the runtime-provided packages it uses`, () => {
        const provided = runtimeProvidedScoped();
        const text = files.map(f => readFileSync(f, "utf8")).join("\n");
        // Only assert about packages this driver actually declares: a driver
        // that never imports @rebasepro/utils should not be forced to.
        const manifest = JSON.parse(
            readFileSync(path.join(ROOT, "packages", driver, "package.json"), "utf8")
        );
        const declared = Object.keys(manifest.dependencies ?? {});
        for (const pkg of provided) {
            if (!declared.includes(pkg)) continue;
            const inlined = !text.includes(`"${pkg}"`) && !text.includes(`'${pkg}'`);
            assert.ok(
                !inlined,
                `${driver} declares ${pkg} but its dist never imports it by name — it was ` +
                `inlined. Add it to RUNTIME_PROVIDED_SCOPED in packages/${driver}/vite.config.ts.`
            );
        }
    });
}
