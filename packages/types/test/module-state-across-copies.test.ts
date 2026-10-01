/**
 * Two copies of this package in one process must share every registry.
 *
 * That is the normal layout, not an edge case. `@rebasepro/server`'s build
 * inlines `@rebasepro/types` into its own dist, while a project's
 * `config/resources.ts` imports the package from `node_modules` — so the
 * runtime that boots and the config it boots are always two copies. A registry
 * held in a module local is one per copy: the project declares a queue handler
 * into its copy, the worker reads the server's empty one and registers no
 * task, and the runtime the server installs is invisible to the project's
 * `enqueue`, which then throws. Queues and topics were dead in every backend
 * that way, while every unit test passed — because a test imports one copy.
 *
 * So this file loads TWO copies (`jest.isolateModules` gives each its own
 * module registry, exactly as two bundles would) and checks the state crosses,
 * and then scans the source for any other module-level state a function
 * mutates after import, which is the shape that splits. Shared state lives on
 * `globalThis` under a `Symbol.for` key (see `registry()` in resources.ts).
 * State that is per copy on purpose is listed below, with the reason.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";

type Kinds = typeof import("../src/types/resource_kinds")
    & typeof import("../src/types/resources")
    & typeof import("../src/types/data_source");

/** One fresh copy of the modules, with its own module registry — as a second bundle would have. */
function loadCopy(): Kinds {
    let copy: Kinds | undefined;
    jest.isolateModules(() => {
        /* eslint-disable @typescript-eslint/no-require-imports */
        copy = {
            ...(require("../src/types/resources") as typeof import("../src/types/resources")),
            ...(require("../src/types/resource_kinds") as typeof import("../src/types/resource_kinds")),
            ...(require("../src/types/data_source") as typeof import("../src/types/data_source"))
        };
        /* eslint-enable @typescript-eslint/no-require-imports */
    });
    if (!copy) throw new Error("isolateModules did not load the module");
    return copy;
}

describe("two copies of @rebasepro/types share queues and topics", () => {
    // `project` stands for the copy config/resources.ts imports; `server` for
    // the copy inlined into @rebasepro/server, which wires workers and
    // installs the runtimes.
    let project: Kinds;
    let server: Kinds;

    beforeEach(() => {
        project = loadCopy();
        server = loadCopy();
        server.resetDeclaredResources();
        server.resetDeclaredQueueConsumers();
        server.resetDeclaredSubscriptions();
        server.setQueueRuntime(null);
        server.setTopicRuntime(null);
    });

    afterAll(() => {
        server.resetDeclaredResources();
        server.resetDeclaredQueueConsumers();
        server.resetDeclaredSubscriptions();
        server.setQueueRuntime(null);
        server.setTopicRuntime(null);
    });

    it("loads two distinct copies (otherwise this suite proves nothing)", () => {
        expect(project).not.toBe(server);
        expect(project.queue).not.toBe(server.queue);
    });

    it("a queue handler declared in one copy is the worker's task in the other", () => {
        project.queue<{ key: string }>("thumbnails").handler(async () => undefined);
        expect(server.declaredQueueConsumers().map(c => c.queue)).toEqual(["thumbnails"]);
    });

    it("a topic subscription declared in one copy is wired by the other", () => {
        project.topic("signups").subscription("send-welcome", async () => undefined);
        expect(server.declaredSubscriptions("signups").map(s => s.name)).toEqual(["send-welcome"]);
    });

    it("a queue runtime installed by the server copy is what the project copy enqueues through", async () => {
        const enqueued: Array<[string, unknown]> = [];
        const thumbnails = project.queue<{ key: string }>("thumbnails");
        server.setQueueRuntime({
            enqueue: async (name, payload) => {
                enqueued.push([name, payload]);
                return { id: "job-1" };
            }
        });
        await expect(thumbnails.enqueue({ key: "a.png" })).resolves.toEqual({ id: "job-1" });
        expect(enqueued).toEqual([["thumbnails", { key: "a.png" }]]);
    });

    it("a topic runtime installed by the server copy is what the project copy publishes through", async () => {
        const published: Array<[string, unknown]> = [];
        const signups = project.topic<{ id: string }>("signups");
        server.setTopicRuntime({ publish: async (t, e) => { published.push([t, e]); } });
        await signups.publish({ id: "u1" });
        expect(published).toEqual([["signups", { id: "u1" }]]);
    });

    it("capabilities a driver registers through its copy are what the app's copy reads", () => {
        const driverCopy = project;
        driverCopy.registerDataSourceCapabilities({
            ...server.getDataSourceCapabilities("postgres"),
            key: "acme-db",
            label: "Acme",
            supportsRealtime: false
        });
        expect(server.getDataSourceCapabilities("acme-db").label).toBe("Acme");
        expect(server.getDataSourceCapabilities("acme-db").supportsRealtime).toBe(false);
    });

    describe("with no runtime installed, the error names the cause it can see", () => {
        // Where @rebasepro/server publishes its client once it has booted.
        const SERVER_SLOT = Symbol.for("@rebasepro/server:singleton-instance");
        const g = globalThis as typeof globalThis & { [SERVER_SLOT]?: unknown };
        afterEach(() => { delete g[SERVER_SLOT]; });

        it("outside a backend, it says so", async () => {
            await expect(project.queue("thumbnails").enqueue({})).rejects.toThrow(/outside one/);
            await expect(project.topic("signups").publish({})).rejects.toThrow(/outside one/);
        });

        it("inside a running backend, it does not blame a build or a script", async () => {
            g[SERVER_SLOT] = {};
            const enqueue = project.queue("thumbnails").enqueue({});
            await expect(enqueue).rejects.toThrow(/backend is running in this process but installed no queue runtime/);
            await expect(enqueue).rejects.not.toThrow(/outside one/);
            await expect(project.topic("signups").publish({}))
                .rejects.toThrow(/same version/);
        });
    });

    it("a second handler for one queue is refused across copies, as within one", () => {
        project.queue("thumbnails").handler(async () => undefined);
        expect(() => server.queue("thumbnails").handler(async () => undefined))
            .toThrow(/already has a handler/);
    });
});

// ── Static scan: module-level state a function mutates ──────────────────────

/**
 * Module-level bindings that are per copy ON PURPOSE. Each needs a reason a
 * reviewer can check; anything else the scan finds is a registry that splits.
 */
const PER_COPY_BY_DESIGN: Record<string, string> = {
    "types/resources.ts#amendments":
        "corrections THIS copy applies on top of a shared kind; an older inlined copy must keep binding " +
        "the way it shipped (see the comment above `amendments`).",
};

const MUTATING_METHODS = new Set([
    "set", "add", "delete", "clear", "push", "pop", "shift", "unshift", "splice",
    "sort", "reverse", "fill", "copyWithin"
]);

function rootIdentifier(expr: ts.Expression): ts.Identifier | undefined {
    let current: ts.Expression = expr;
    for (;;) {
        if (ts.isIdentifier(current)) return current;
        if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)
            || ts.isNonNullExpression(current) || ts.isParenthesizedExpression(current)
            || ts.isAsExpression(current)) {
            current = current.expression;
            continue;
        }
        return undefined;
    }
}

function insideFunction(node: ts.Node): boolean {
    for (let p = node.parent; p; p = p.parent) {
        if (ts.isFunctionLike(p)) return true;
    }
    return false;
}

const ASSIGNMENT_OPERATORS = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken,
    ts.SyntaxKind.AsteriskEqualsToken, ts.SyntaxKind.SlashEqualsToken, ts.SyntaxKind.BarBarEqualsToken,
    ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken,
    ts.SyntaxKind.BarEqualsToken, ts.SyntaxKind.AmpersandEqualsToken
]);

/**
 * `file#name` for every top-level binding that code inside a function writes
 * to — reassigns, assigns a member of, or calls a mutating method on. State
 * built once at import is the same in every copy and is not reported.
 */
function mutatedModuleState(rel: string, source: string): string[] {
    const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const topLevel = new Set<string>();
    for (const stmt of sf.statements) {
        if (!ts.isVariableStatement(stmt)) continue;
        for (const decl of stmt.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) topLevel.add(decl.name.text);
        }
    }
    // `const consumers = registry;` inside a function, then `consumers.set(…)`:
    // the write lands on the top-level binding through a local alias.
    const aliasOf = new Map<string, string>();
    const collectAliases = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && node.initializer && insideFunction(node)) {
            const root = rootIdentifier(node.initializer);
            const target = root && (topLevel.has(root.text) ? root.text : aliasOf.get(root.text));
            if (target) {
                if (ts.isIdentifier(node.name)) aliasOf.set(node.name.text, target);
                else if (ts.isObjectBindingPattern(node.name)) {
                    for (const el of node.name.elements) {
                        if (ts.isIdentifier(el.name)) aliasOf.set(el.name.text, target);
                    }
                }
            }
        }
        ts.forEachChild(node, collectAliases);
    };
    collectAliases(sf);
    const hits = new Set<string>();
    const hit = (id: ts.Identifier | undefined, at: ts.Node) => {
        if (!id || !insideFunction(at)) return;
        const name = topLevel.has(id.text) ? id.text : aliasOf.get(id.text);
        if (name) hits.add(`${rel}#${name}`);
    };
    const visit = (node: ts.Node): void => {
        if (ts.isBinaryExpression(node) && ASSIGNMENT_OPERATORS.has(node.operatorToken.kind)) {
            hit(rootIdentifier(node.left), node);
        } else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
            && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
            hit(rootIdentifier(node.operand), node);
        } else if (ts.isDeleteExpression(node)) {
            hit(rootIdentifier(node.expression), node);
        } else if (ts.isCallExpression(node)) {
            const callee = node.expression;
            if (ts.isPropertyAccessExpression(callee) && MUTATING_METHODS.has(callee.name.text)) {
                hit(rootIdentifier(callee.expression), node);
            }
            if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
                && callee.expression.text === "Object" && callee.name.text === "assign" && node.arguments[0]) {
                hit(rootIdentifier(node.arguments[0]), node);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return [...hits].sort();
}

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...sourceFiles(full));
        else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
    }
    return out;
}

describe("no other module-level registry in @rebasepro/types splits across copies", () => {
    const srcRoot = path.join(__dirname, "..", "src");

    it("the scan sees a module-local registry for what it is", () => {
        const sample = [
            "const consumers = new Map<string, unknown>();",
            "const holder = { current: null as unknown };",
            "let count = 0;",
            "const TABLE = new Map([[1, 2]]);",
            "TABLE.set(3, 4);",
            "export function register(k: string) { consumers.set(k, 1); }",
            "export function install(r: unknown) { holder.current = r; }",
            "export function bump() { count++; }",
            "export function read() { return TABLE.get(1); }",
            "const aliased = new Map<string, number>();",
            "export function viaAlias(k: string) { const m = aliased; m.set(k, 1); }"
        ].join("\n");
        expect(mutatedModuleState("x.ts", sample))
            .toEqual(["x.ts#aliased", "x.ts#consumers", "x.ts#count", "x.ts#holder"]);
    });

    it("every module-level binding a function writes is either on globalThis or per copy by design", () => {
        const found = sourceFiles(srcRoot).flatMap(file => {
            const rel = path.relative(srcRoot, file).split(path.sep).join("/");
            return mutatedModuleState(rel, fs.readFileSync(file, "utf8"));
        });
        const unexplained = found.filter(k => !(k in PER_COPY_BY_DESIGN));
        if (unexplained.length > 0) {
            throw new Error(
                "Module-level state that code mutates after import, in a package that is inlined into " +
                "other packages' bundles — each copy would get its own:\n  " + unexplained.join("\n  ") +
                "\n\nKeep it on globalThis under a Symbol.for key (see registry() in types/resources.ts), " +
                "or, if it must be per copy, add it to PER_COPY_BY_DESIGN with the reason."
            );
        }
        // A stale entry is a reason nobody is checking any more.
        expect(Object.keys(PER_COPY_BY_DESIGN).filter(k => !found.includes(k))).toEqual([]);
    });
});
