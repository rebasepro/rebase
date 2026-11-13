import { execFileSync } from "child_process";
import path from "path";

/**
 * `rebaseBackendGuard` refuses, in a real Vite build, every import form that
 * reaches `backend/` — the security review's ten (S-2) and the ones beyond
 * them — and a control build of the same project without the guard ships the
 * marker the backend's hook file sets, so each refusal is a refusal of
 * something real. `backend-guard/run-fixtures.mjs` does the building (Vite 8
 * is ESM only); this reads its report.
 */

interface BuildResult {
    ok: boolean;
    leaked?: boolean;
    error?: string;
    view?: boolean;
}

interface Report {
    forms: Record<string, { guarded: BuildResult; control: BuildResult }>;
    clean: BuildResult;
    dev: Record<string, BuildResult>;
    mcpView: Record<string, BuildResult>;
    caseInsensitive: boolean;
}

function isReport(value: unknown): value is Report {
    return typeof value === "object" && value !== null && "forms" in value && "clean" in value && "dev" in value && "mcpView" in value;
}

let report: Report;

beforeAll(() => {
    const out = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", path.join(__dirname, "backend-guard", "run-fixtures.mjs")], {
        cwd: path.join(__dirname, ".."),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 16 * 1024 * 1024
    });
    const parsed: unknown = JSON.parse(out);
    if (!isReport(parsed)) throw new Error(`run-fixtures.mjs printed no report: ${out.slice(0, 500)}`);
    report = parsed;
}, 120_000);

/** Forms whose control build ships backend code: the guard must refuse each, naming the importer and the backend file. */
const SHIPPING_FORMS: Record<string, string> = {
    "relative": "frontend/src/main.ts",
    "glob-eager": "frontend/src/main.ts",
    "package-imports": "frontend/src/main.ts",
    "alias": "frontend/src/main.ts",
    "package-name": "frontend/src/main.ts",
    "aliased-require": "frontend/src/main.ts",
    "absolute": "frontend/src/main.ts",
    "sibling-reexport": "shared/reexports-backend.ts",
    "glob-lazy": "frontend/src/main.ts",
    "raw-query": "frontend/src/main.ts",
    "side-effect": "frontend/src/main.ts",
    "export-from": "frontend/src/main.ts",
    "dynamic-literal": "frontend/src/main.ts",
    "package-name-preserve-symlinks": "frontend/src/main.ts"
};

/**
 * Ways a Vite build pulls a file in without an `import` statement (SEC-FIX-2
 * F-5): the form, the file that names the backend, how it names it, and the
 * backend file. "imports" forms go through module resolution (a query, a
 * glob, a worker's own build); "references" forms are files Vite copies or
 * inlines (`new URL`, a stylesheet's `@import` / `url()`, an HTML `src`).
 */
const NON_IMPORT_FORMS: [string, string, "imports" | "references", string][] = [
    ["new-url", "frontend/src/main.ts", "references", "backend/schema/posts.ts"],
    ["new-url-large", "frontend/src/main.ts", "references", "backend/data/large.json"],
    ["new-url-alias", "frontend/src/main.ts", "references", "backend/schema/posts.ts"],
    ["new-url-template", "frontend/src/main.ts", "imports", "backend/schema/posts.ts"],
    ["url-query", "frontend/src/main.ts", "imports", "backend/schema/posts.ts"],
    ["url-inline-query", "frontend/src/main.ts", "imports", "backend/schema/posts.ts"],
    ["glob-url", "frontend/src/main.ts", "imports", "backend/schema/posts.ts"],
    ["css-inline-query", "frontend/src/main.ts", "imports", "backend/theme.css"],
    ["css-import", "frontend/src/leaky.css", "references", "backend/theme.css"],
    ["css-url", "frontend/src/leaky.css", "references", "backend/schema/posts.ts"],
    ["worker-query", "frontend/src/work.ts", "imports", "backend/schema/posts.ts"],
    ["worker-new-url", "frontend/src/work.ts", "imports", "backend/schema/posts.ts"],
    ["worker-backend-file", "frontend/src/main.ts", "references", "backend/schema/posts.ts"],
    ["html-asset", "frontend/index.html", "references", "backend/data/large.json"],
    // SEC-FIX-3: spellings Vite still reads as an asset reference — comments
    // inside the call, an escaped literal, single quotes.
    ["new-url-comment", "frontend/src/main.ts", "references", "backend/schema/posts.ts"],
    ["new-url-escaped", "frontend/src/main.ts", "references", "backend/schema/posts.ts"],
    ["new-url-single-quote", "frontend/src/main.ts", "references", "backend/schema/posts.ts"]
];

/**
 * Forms the bundler does not follow: `createRequire(…)(path)`, `import(variable)`,
 * a computed `new URL(…)` and `import.meta.resolve(…)`
 * put no backend code in the bundle (the control proves it), so there is
 * nothing to refuse. In a browser they fail at runtime.
 */
const NON_SHIPPING_FORMS = [
    "create-require", "dynamic-variable",
    // SEC-FIX-3: `new URL` over a concatenation or a variable, and
    // `import.meta.resolve`, are not assets to Vite: nothing is copied.
    "new-url-concat", "new-url-variable", "meta-resolve"
];

describe("rebaseBackendGuard in a real build", () => {
    it("outside-project: a module outside the project that reaches backend/ is refused when the file loads", () => {
        const { guarded, control } = report.forms["outside-project"];
        expect(control).toEqual({ ok: true, leaked: true });
        expect(guarded.ok).toBe(false);
        expect(guarded.error).toMatch(/\[rebase-backend-guard\] backend\/schema\/posts\.ts (is imported by|was requested)/);
    });

    it.each(Object.entries(SHIPPING_FORMS))("%s: the control ships the hook file, the guarded build is refused", (form, importer) => {
        const { guarded, control } = report.forms[form];
        expect(control).toEqual({ ok: true, leaked: true });
        expect(guarded.ok).toBe(false);
        expect(guarded.error).toContain("[rebase-backend-guard]");
        expect(guarded.error).toContain(`${importer} imports "`);
        expect(guarded.error).toContain("which resolves to backend/schema/posts.ts");
        expect(guarded.error).toContain("import type");
    });

    it.each(NON_IMPORT_FORMS)("%s: the control ships the backend file, the guarded build is refused", (form, importer, how, file) => {
        const { guarded, control } = report.forms[form];
        expect(control).toEqual({ ok: true, leaked: true });
        expect(guarded.ok).toBe(false);
        expect(guarded.error).toContain("[rebase-backend-guard]");
        expect(guarded.error).toContain(`${importer} ${how} "`);
        expect(guarded.error).toContain(`which resolves to ${file}`);
    });

    it.each(NON_SHIPPING_FORMS)("%s: nothing reaches the bundle, with or without the guard", (form) => {
        const { guarded, control } = report.forms[form];
        expect(control).toEqual({ ok: true, leaked: false });
        expect(guarded).toEqual({ ok: true, leaked: false });
    });

    it("compares real paths: another case of `backend/` on a case-insensitive file system is the same directory", () => {
        if (!report.caseInsensitive) return;
        const { guarded, control } = report.forms["other-case"];
        expect(control).toEqual({ ok: true, leaked: true });
        expect(guarded.ok).toBe(false);
        expect(guarded.error).toContain("which resolves to backend/schema/posts.ts");
    });

    it("leaves a type import, a ?raw text file, JSON and CSS alone", () => {
        expect(report.clean).toEqual({ ok: true, leaked: false });
    });

    it("fails the dev server's load of the importing module, and a direct /@fs/ request for a backend file", () => {
        expect(report.dev.importer.ok).toBe(false);
        expect(report.dev.importer.error).toContain("frontend/src/main.ts imports \"../../backend/schema/posts\"");
        expect(report.dev["fs-request"].ok).toBe(false);
        expect(report.dev["fs-request"].error).toContain("backend/schema/posts.ts was requested");
    });

    it("guards the MCP view's build of the project's App, which reads the same config file", () => {
        expect(report.mcpView["mcp-view-clean"]).toEqual({ ok: true, view: true });
        expect(report.mcpView["mcp-view-leak"].ok).toBe(false);
        expect(report.mcpView["mcp-view-leak"].error).toContain("frontend/src/App.tsx imports \"../../backend/schema/posts\"");
    });
});
