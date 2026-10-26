/**
 * `rebase generate view` against the layout `rebase init` writes.
 *
 * The scaffold is copied from `templates/template`, not described here, so a
 * change to the template's `App.tsx` or a collection file is a change these
 * tests see. Every file the command edits is parsed afterwards, and the files
 * it writes are compiled against the workspace source of `@rebasepro/*`: a
 * generated view that does not compile is the first thing a user would see.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    appViewSource,
    entityViewSource,
    generateCommand,
    maskCode,
    planGenerateView,
    registerEntityView,
    viewComponentName,
    viewLabel,
    wireViewsIntoApp
} from "./generate-view";

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, "../../templates/template");
const repoRoot = path.resolve(here, "../../../..");

let project: string;

/** A project as `rebase init` lays it out: the manifest, the frontend's entry, the blog collections. */
function scaffold(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-generate-view-"));
    const copy = (relative: string) => {
        fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
        fs.copyFileSync(path.join(templateDir, relative), path.join(root, relative));
    };
    copy("rebase.json");
    copy("frontend/package.json");
    copy("frontend/src/App.tsx");
    for (const file of fs.readdirSync(path.join(templateDir, "config/collections"))) {
        if (file.endsWith(".ts")) copy(`config/collections/${file}`);
    }
    return root;
}

function read(relative: string): string {
    return fs.readFileSync(path.join(project, relative), "utf8");
}

/** Syntax errors only: the edited file must still be a program. */
function syntaxErrors(file: string, source: string): string[] {
    const result = ts.transpileModule(source, {
        fileName: file,
        reportDiagnostics: true,
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
    });
    return (result.diagnostics ?? []).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

function write(plan: ReturnType<typeof planGenerateView>): void {
    for (const file of plan.files) {
        fs.mkdirSync(path.dirname(file.path), { recursive: true });
        fs.writeFileSync(file.path, file.contents);
    }
}

beforeEach(() => {
    project = scaffold();
});

afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe("names", () => {
    it("derives the component and the label from the slug", () => {
        expect(viewComponentName("orders-board")).toBe("OrdersBoardView");
        expect(viewComponentName("sales-view")).toBe("SalesView");
        expect(viewLabel("orders-board")).toBe("Orders board");
    });
});

describe("a screen", () => {
    it("refuses a slug the admin's own routes already answer", () => {
        // `/settings`, `/s` (Studio) and `/c/*` (collections) are declared
        // before custom views, so a view at one of them was listed in the
        // sidebar and opened the built-in page instead.
        for (const slug of ["settings", "s", "c"]) {
            expect(() => planGenerateView({ projectRoot: project, slug })).toThrow(/admin.*own|reserved/i);
        }
        // A record tab is not a route of its own, so it may use the name.
        expect(() => planGenerateView({ projectRoot: project, slug: "settings", collection: "posts" })).not.toThrow(/reserved/i);
    });

    it("writes the view and the screens list, and wires App.tsx", () => {
        const plan = planGenerateView({ projectRoot: project, slug: "orders-board" });
        const written = plan.files.map(f => [path.relative(project, f.path), f.action]);
        // The scaffold already declares @rebasepro/cms-types, so its package.json is not touched.
        expect(written).toEqual([
            ["frontend/src/views/OrdersBoardView.tsx", "create"],
            ["frontend/src/views/index.ts", "create"],
            ["frontend/src/App.tsx", "update"]
        ]);
        expect(plan.manualSteps).toEqual([]);
        write(plan);

        const app = read("frontend/src/App.tsx");
        expect(app).toMatch(/<RebaseCMS\s+views=\{views\}\s+collections=\{collections\}/);
        expect(app).toContain("import { views } from \"./views\";");
        expect(syntaxErrors("App.tsx", app)).toEqual([]);

        const index = read("frontend/src/views/index.ts");
        expect(index).toContain("import { OrdersBoardView } from \"./OrdersBoardView\";");
        expect(index).toMatch(/slug: "orders-board",\s+name: "Orders board",\s+icon: "LayoutDashboard",\s+view: OrdersBoardView/);

        const view = read("frontend/src/views/OrdersBoardView.tsx");
        // The first collection that is not the users table, so the screen shows data on first run.
        expect(view).toContain("const COLLECTION = \"authors\";");
        expect(view).toContain("export default OrdersBoardView;");
    });

    it("declares @rebasepro/cms-types in a frontend that predates it, at the cms version", () => {
        const manifestFile = path.join(project, "frontend/package.json");
        const manifest = JSON.parse(read("frontend/package.json"));
        delete manifest.dependencies["@rebasepro/cms-types"];
        manifest.dependencies["@rebasepro/cms"] = "^1.4.0";
        fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 4));

        const plan = planGenerateView({ projectRoot: project, slug: "orders-board" });
        write(plan);
        const pkg = JSON.parse(read("frontend/package.json"));
        expect(pkg.dependencies["@rebasepro/cms-types"]).toBe("^1.4.0");
        expect(plan.manualSteps.join("\n")).toMatch(/install/);
    });

    it("appends a second screen without touching App.tsx again", () => {
        write(planGenerateView({ projectRoot: project, slug: "orders-board" }));
        const appBefore = read("frontend/src/App.tsx");

        const plan = planGenerateView({ projectRoot: project, slug: "dispatch", name: "Dispatch desk", icon: "Truck" });
        expect(plan.files.map(f => path.relative(project, f.path)).sort()).toEqual([
            "frontend/src/views/DispatchView.tsx",
            "frontend/src/views/index.ts"
        ]);
        expect(plan.manualSteps).toEqual([]);
        write(plan);

        expect(read("frontend/src/App.tsx")).toBe(appBefore);
        const index = read("frontend/src/views/index.ts");
        expect(index).toContain("import { DispatchView } from \"./DispatchView\";");
        expect(index).toMatch(/view: OrdersBoardView\n {4}\},\n {4}\{\n {8}slug: "dispatch",\n {8}name: "Dispatch desk",\n {8}icon: "Truck",\n {8}view: DispatchView\n {4}\}\n\];/);
        expect(syntaxErrors("index.ts", index)).toEqual([]);
    });

    it("refuses to overwrite a view unless forced, and never lists it twice", () => {
        write(planGenerateView({ projectRoot: project, slug: "orders-board" }));
        expect(() => planGenerateView({ projectRoot: project, slug: "orders-board" })).toThrow(/already exists.*--force/);

        const plan = planGenerateView({ projectRoot: project, slug: "orders-board", force: true });
        expect(plan.files.map(f => [path.relative(project, f.path), f.action])).toEqual([
            ["frontend/src/views/OrdersBoardView.tsx", "replace"]
        ]);
    });

    it("leaves an App.tsx that passes its own views alone and says what to add", () => {
        const appFile = path.join(project, "frontend/src/App.tsx");
        fs.writeFileSync(appFile, read("frontend/src/App.tsx").replace("<RebaseCMS", "<RebaseCMS views={myViews}"));
        const plan = planGenerateView({ projectRoot: project, slug: "orders-board" });
        expect(plan.files.map(f => path.relative(project, f.path))).not.toContain("frontend/src/App.tsx");
        expect(plan.manualSteps.join("\n")).toMatch(/\.\.\.views/);
    });

    it("finds the frontend where rebase.json mounts the CMS", () => {
        fs.renameSync(path.join(project, "frontend"), path.join(project, "admin"));
        const manifest = JSON.parse(read("rebase.json"));
        manifest.apps.admin.root = "admin";
        fs.writeFileSync(path.join(project, "rebase.json"), JSON.stringify(manifest));

        const plan = planGenerateView({ projectRoot: project, slug: "orders-board" });
        expect(path.relative(project, plan.viewFile)).toBe("admin/src/views/OrdersBoardView.tsx");
    });
});

describe("a record tab (--collection)", () => {
    it("adds an entityViews entry by path to the collection's existing admin block", () => {
        const plan = planGenerateView({ projectRoot: project, slug: "audit-trail", collection: "posts" });
        write(plan);

        const posts = read("config/collections/posts.ts");
        expect(posts).toMatch(/admin: \{\n {8}entityViews: \[\n {12}\{\n {16}key: "audit-trail",\n {16}name: "Audit trail",\n {16}Builder: "\.\.\/\.\.\/frontend\/src\/views\/AuditTrailView"\n {12}\}\n {8}\],/);
        expect(syntaxErrors("posts.ts", posts)).toEqual([]);

        const view = read("frontend/src/views/AuditTrailView.tsx");
        expect(view).toContain("EntityCustomViewParams");
        expect(view).toContain("export default AuditTrailView;");
        // A screen's list is not touched by a record tab.
        expect(fs.existsSync(path.join(project, "frontend/src/views/index.ts"))).toBe(false);
    });

    it("appends to an entityViews list that exists, and does not add a key twice", () => {
        write(planGenerateView({ projectRoot: project, slug: "audit-trail", collection: "posts" }));
        write(planGenerateView({ projectRoot: project, slug: "preview", collection: "posts" }));
        const posts = read("config/collections/posts.ts");
        expect(posts.match(/key: "audit-trail"/g)).toHaveLength(1);
        expect(posts).toMatch(/Builder: "\.\.\/\.\.\/frontend\/src\/views\/AuditTrailView"\n {12}\},\n {12}\{\n {16}key: "preview",/);
        expect(syntaxErrors("posts.ts", posts)).toEqual([]);

        const again = planGenerateView({ projectRoot: project, slug: "preview", collection: "posts", force: true });
        expect(again.files.map(f => path.relative(project, f.path))).not.toContain("config/collections/posts.ts");
    });

    it("names the collections there are when the slug matches none", () => {
        expect(() => planGenerateView({ projectRoot: project, slug: "audit-trail", collection: "orders" }))
            .toThrow(/No collection with slug "orders".*Declared: authors, posts, tags, users/);
    });
});

describe("registerEntityView", () => {
    const collection = (body: string) => `import { defineCollection } from "@rebasepro/cms-types";

export default defineCollection({
    name: "Orders",
    slug: "orders",
${body}
    properties: {
        total: { type: "number", validation: { matches: /\\{/ } }
    }
});
`;
    const view = { key: "audit", name: "Audit", builder: "../../frontend/src/views/AuditView" };
    const register = (source: string) => registerEntityView(source, source.indexOf("slug:"), view);

    it("creates the admin block when there is none", () => {
        const updated = register(collection(""));
        expect(updated).toContain("    slug: \"orders\",\n    admin: {\n        entityViews: [\n            {\n                key: \"audit\",");
        expect(syntaxErrors("orders.ts", String(updated))).toEqual([]);
    });

    it("fills an empty admin block, and is not fooled by braces in strings or regexes", () => {
        const updated = register(collection("    admin: {},\n    description: \"{ not code }\","));
        expect(updated).toMatch(/admin: \{\n {8}entityViews: \[[\s\S]*?\]\n {4}\},/);
        expect(syntaxErrors("orders.ts", String(updated))).toEqual([]);
    });

    it("recognises a view registered by key, in either form", () => {
        expect(register(collection("    admin: { entityViews: [\"audit\"] },"))).toBe("already");
        expect(register(collection("    admin: { entityViews: [{ key: \"audit\", name: \"A\" }] },"))).toBe("already");
    });

    it("does not reach into a nested admin block", () => {
        const source = collection("    properties2: { admin: { entityViews: [] } },");
        const updated = String(register(source));
        expect(updated).toContain("    slug: \"orders\",\n    admin: {");
        expect(updated).toContain("properties2: { admin: { entityViews: [] } }");
    });
});

describe("wireViewsIntoApp", () => {
    it("refuses when a views name is already in scope", () => {
        expect(wireViewsIntoApp("const views = [];\nexport const A = () => <RebaseCMS collections={c}/>;")).toBeUndefined();
    });

    it("puts the prop on the same line when the tag is on one line", () => {
        expect(wireViewsIntoApp("import x from \"x\";\nexport const A = () => <RebaseCMS collections={c}/>;"))
            .toBe("import x from \"x\";\nimport { views } from \"./views\";\nexport const A = () => <RebaseCMS views={views} collections={c}/>;");
    });
});

describe("maskCode", () => {
    it("keeps positions and blanks strings, comments and regexes", () => {
        const source = "const a = \"{\"; // }\nconst b = /[}]/; /* { */ const c = { d: 1 };";
        const masked = maskCode(source);
        expect(masked).toHaveLength(source.length);
        expect(masked.replace(/[^{}]/g, "")).toBe("{}");
    });
});

describe("the command", () => {
    it("refuses a slug that is not a slug, and a project with no admin", async () => {
        expect(() => planGenerateView({ projectRoot: project, slug: "Orders Board" })).toThrow(/not a view slug/);
        fs.rmSync(path.join(project, "frontend"), { recursive: true });
        const manifest = JSON.parse(read("rebase.json"));
        delete manifest.apps.admin;
        fs.writeFileSync(path.join(project, "rebase.json"), JSON.stringify(manifest));
        expect(() => planGenerateView({ projectRoot: project, slug: "orders-board" })).toThrow(/no admin panel/);
    });

    it("writes nothing on --dry-run and prints what it would do", async () => {
        const cwd = process.cwd();
        const printed: string[] = [];
        vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
            printed.push(args.map(String).join(" "));
        });
        process.chdir(project);
        try {
            await generateCommand("view", ["node", "rebase", "generate", "view", "orders-board", "--dry-run"]);
        } finally {
            process.chdir(cwd);
        }
        expect(fs.existsSync(path.join(project, "frontend/src/views"))).toBe(false);
        expect(printed.join("\n")).toContain("would be created  frontend/src/views/OrdersBoardView.tsx");
    });

    it("rejects --icon on a record tab and an unknown flag", async () => {
        await expect(generateCommand("view", ["node", "rebase", "generate", "view", "a", "--collection", "posts", "--icon", "X"]))
            .rejects.toThrow(/--icon is for a screen/);
        await expect(generateCommand("view", ["node", "rebase", "generate", "view", "a", "--colection", "posts"]))
            .rejects.toThrow(/did you mean --collection/);
    });
});

/**
 * The generated components compile against the admin's real types.
 *
 * Compiled from a directory inside this package, so `react` and its types
 * resolve the way they do for every other file here, with `@rebasepro/*`
 * mapped to workspace source by the repository's typecheck config.
 */
describe("the generated files compile", () => {
    it("typechecks a screen, its list, and a record tab", () => {
        write(planGenerateView({ projectRoot: project, slug: "orders-board" }));
        write(planGenerateView({ projectRoot: project, slug: "audit-trail", collection: "posts" }));

        const checkDir = fs.mkdtempSync(path.join(here, ".generated-view-check-"));
        try {
            for (const name of ["OrdersBoardView.tsx", "index.ts", "AuditTrailView.tsx"]) {
                fs.copyFileSync(path.join(project, "frontend/src/views", name), path.join(checkDir, name));
            }
            const parsed = ts.getParsedCommandLineOfConfigFile(path.join(repoRoot, "tsconfig.typecheck.json"), {}, {
                ...ts.sys,
                onUnRecoverableConfigFileDiagnostic: d => {
                    throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
                }
            });
            if (!parsed) throw new Error("could not read tsconfig.typecheck.json");
            const program = ts.createProgram({
                rootNames: fs.readdirSync(checkDir).map(name => path.join(checkDir, name)),
                options: { ...parsed.options, noEmit: true, types: [] }
            });
            const errors = ts.getPreEmitDiagnostics(program)
                .filter(d => d.file?.fileName.startsWith(checkDir))
                .map(d => `${path.basename(d.file?.fileName ?? "")}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
            expect(errors).toEqual([]);
        } finally {
            fs.rmSync(checkDir, { recursive: true, force: true });
        }
    }, 180_000);
});

describe("a view's label is quoted, not pasted", () => {
    const LABEL = "KPIs {beta} <c> & */ \"d\"";

    /** Every identifier the source reads and every JSX text/string it renders. */
    function readsAndRenders(source: string): { identifiers: Set<string>; rendered: string[] } {
        const file = ts.createSourceFile("View.tsx", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
        const identifiers = new Set<string>();
        const rendered: string[] = [];
        const visit = (node: ts.Node): void => {
            if (ts.isIdentifier(node)) identifiers.add(node.text);
            if (ts.isJsxText(node) && node.text.trim()) rendered.push(node.text.trim());
            if (ts.isJsxExpression(node) && node.expression && ts.isStringLiteral(node.expression)) rendered.push(node.expression.text);
            ts.forEachChild(node, visit);
        };
        visit(file);
        return { identifiers, rendered };
    }

    it.each([
        ["a screen", appViewSource],
        ["a record tab", entityViewSource]
    ])("in %s, a label with JSX characters compiles and renders as typed", (_kind, source) => {
        const code = source({ slug: "kpis", componentName: "KpisView", label: LABEL, collection: "posts" });
        expect(syntaxErrors("View.tsx", code)).toEqual([]);
        const { identifiers, rendered } = readsAndRenders(code);
        expect(identifiers.has("beta")).toBe(false);
        expect(rendered).toContain(LABEL);
    });

    it("leaves a plain label as plain JSX text", () => {
        const code = appViewSource({ slug: "kpis", componentName: "KpisView", label: "Sales KPIs", collection: "posts" });
        expect(code).toContain(">Sales KPIs</Typography>");
    });
});
