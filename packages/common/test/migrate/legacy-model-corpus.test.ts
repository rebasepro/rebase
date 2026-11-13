/**
 * The frozen legacy model is complete: every legacy project this repository
 * keeps type-checks against it.
 *
 * `@rebasepro/common/migrate`'s `legacy-model` is the input format of the
 * migration — it must accept everything a 0.30 `config/collections` could say.
 * The proof is the corpus: the frozen plan-golden inputs
 * (`packages/server-postgres/test/fixtures/plan-corpus-legacy/**`: the demo
 * app, every CLI preset, the introspected real schemas, the docs sample) and
 * the codemod's legacy fixtures (`__fixtures__/<case>/input/config/**`). Each
 * is compiled here, strict, with its `// @ts-nocheck` stripped and its kernel
 * imports answered by the frozen model under the names 0.30 exported — the
 * corpus through its own `legacy-model.ts`, the codemod fixtures through a
 * stand-in module written below. A field the frozen model lacks, or types more
 * narrowly than 0.30 did, is a diagnostic here.
 *
 * What is NOT the model, and so not checked:
 *
 * - code inside a function body (a callback's, a storage function's, an
 *   action's): it is user code written against 0.30's SDK and panel, which the
 *   codemod carries as source. A callback's SIGNATURE is the model, and is
 *   checked: its parameters must be typed by the frozen props.
 * - an implicit `any` inside an `admin` block: the frozen block types its
 *   values `unknown` (the codemod moves them as source, and the CMS's option
 *   types must not reach the migration module), so a panel callback written
 *   there has nothing to type its parameters from.
 * - an import of the demo app's frontend components, which the corpus does
 *   not copy.
 */
import { describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const REPO = path.resolve(__dirname, "..", "..", "..", "..");
const CORPUS = path.join(REPO, "packages", "server-postgres", "test", "fixtures", "plan-corpus-legacy");
const CODEMOD_FIXTURES = path.join(REPO, "packages", "cli", "src", "codemod", "collections-to-tables", "__fixtures__");
const MIGRATE = path.join(REPO, "packages", "common", "src", "migrate", "index.ts");

/** Where the codemod fixtures' `@rebasepro/{types,common,cms-types}` imports resolve. */
const STAND_IN = path.join(CODEMOD_FIXTURES, "__legacy-kernel-stand-in__.ts");
const STAND_IN_SOURCE = `
import type { DefinedLegacyCollection, LegacyWithAdminCollectionConfig } from ${JSON.stringify(MIGRATE)};
import type { RebaseCallContext } from "@rebasepro/types";
export type {
    LegacyAnyCollectionConfig as AnyCollectionConfig,
    LegacyCollectionCallbacks as CollectionCallbacks,
    LegacyEnumValueConfig as EnumValueConfig,
    LegacyWithAdminFirebaseCollectionConfig as FirebaseCollectionConfig,
    LegacyWithAdminPostgresCollectionConfig as PostgresCollectionConfig,
    LegacyWithAdminProperties as Properties
} from ${JSON.stringify(MIGRATE)};
export type { SecurityRule } from "@rebasepro/types";
export type EntityCallbackContext = RebaseCallContext;
export declare function defineCollection<C extends LegacyWithAdminCollectionConfig>(collection: C): DefinedLegacyCollection<C>;
`;

const LEGACY_KERNEL = new Set(["@rebasepro/types", "@rebasepro/common", "@rebasepro/cms-types"]);

function walk(dir: string, accept: (file: string) => boolean, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, accept, out);
        else if (accept(full)) out.push(full);
    }
    return out;
}

/** The codemod fixtures, as the `.ts` files they stand for (`x.ts.txt` → `x.ts`). */
function codemodInputs(): string[] {
    return walk(CODEMOD_FIXTURES, file => /[/\\]input[/\\]config[/\\]/.test(file) && file.endsWith(".ts.txt"))
        .map(file => file.slice(0, -".txt".length));
}

function corpusInputs(): string[] {
    return walk(CORPUS, file => file.endsWith(".ts"));
}

function compile(roots: string[]): ts.Diagnostic[] {
    const options: ts.CompilerOptions = {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
        types: [],
        baseUrl: REPO,
        paths: {
            "@rebasepro/types": ["packages/types/src/index.ts"],
            "@rebasepro/utils": ["packages/utils/src/index.ts"],
            "@rebasepro/common/migrate": ["packages/common/src/migrate/index.ts"]
        }
    };
    const host = ts.createCompilerHost(options, true);
    const isCodemodInput = (file: string) => file.startsWith(CODEMOD_FIXTURES) && file !== STAND_IN;
    const readVirtual = (file: string): string | undefined => {
        if (file === STAND_IN) return STAND_IN_SOURCE;
        if (isCodemodInput(file) && fs.existsSync(`${file}.txt`)) return fs.readFileSync(`${file}.txt`, "utf8");
        return undefined;
    };
    const baseGetSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
        const virtual = readVirtual(fileName);
        if (virtual !== undefined) return ts.createSourceFile(fileName, virtual, languageVersion, true);
        if (fileName.startsWith(CORPUS)) {
            // The one non-semantic edit the corpus carries, undone.
            const text = fs.readFileSync(fileName, "utf8").replace(/^\/\/ @ts-nocheck[^\n]*\n/, "");
            return ts.createSourceFile(fileName, text, languageVersion, true);
        }
        return baseGetSourceFile(fileName, languageVersion, onError, shouldCreate);
    };
    const baseFileExists = host.fileExists.bind(host);
    host.fileExists = file => readVirtual(file) !== undefined || baseFileExists(file);
    host.resolveModuleNameLiterals = (literals, containingFile, _redirect, compilerOptions) => literals.map(literal => {
        if (isCodemodInput(containingFile) && LEGACY_KERNEL.has(literal.text)) {
            return { resolvedModule: { resolvedFileName: STAND_IN, extension: ts.Extension.Ts, isExternalLibraryImport: false } };
        }
        // `../fragments.js` in a fixture names its `.ts` sibling (bundler resolution would too).
        const text = isCodemodInput(containingFile) ? literal.text.replace(/\.js$/, "") : literal.text;
        return ts.resolveModuleName(text, containingFile, compilerOptions, host);
    });
    const program = ts.createProgram({ rootNames: roots, options, host });
    return roots.flatMap(root => {
        const source = program.getSourceFile(root);
        if (!source) throw new Error(`${root} is not in the program`);
        return [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)];
    });
}

/** The text ranges of every function body, and of every `admin: { … }` block, in a source file. */
function exemptRanges(source: ts.SourceFile): { bodies: [number, number][]; admin: [number, number][] } {
    const bodies: [number, number][] = [];
    const admin: [number, number][] = [];
    const visit = (node: ts.Node): void => {
        if ((ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) && node.body) {
            bodies.push([node.body.getStart(source), node.body.getEnd()]);
        }
        if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "admin") {
            admin.push([node.initializer.getStart(source), node.initializer.getEnd()]);
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return { bodies, admin };
}

/**
 * Inputs that say something 0.30's own types refused too: the loader read
 * them (it never type-checked), so the codemod must handle them, but the
 * frozen model is the released types and does not widen for them.
 */
const INVALID_AT_0_30: { file: RegExp; message: RegExp; why: string }[] = [
    {
        file: /__fixtures__\/typed\/input\/config\/collections\/tickets\.ts$/,
        message: /not assignable to type '\(\) => LegacyCollectionConfig/,
        why: "`childCollections: []` — 0.30 typed it as a thunk; the fixture checks the codemod reports the value as presentation."
    }
];

/** Implicit-`any` diagnostics: a parameter with nothing to type it from. */
const IMPLICIT_ANY = new Set([7006, 7031]);

/** Whether a diagnostic is about the model (see the header for what is not). */
function isModelDiagnostic(diagnostic: ts.Diagnostic): boolean {
    const { file, start } = diagnostic;
    if (!file || start === undefined) return true;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    if (INVALID_AT_0_30.some(known => known.file.test(file.fileName) && known.message.test(message))) return false;
    if (diagnostic.code === 2307 && /['"][^'"]*\/frontend\/[^'"]*['"]/.test(message)) return false;
    const { bodies, admin } = exemptRanges(file);
    const inside = (ranges: [number, number][]) => ranges.some(([from, to]) => start >= from && start < to);
    if (inside(bodies)) return false;
    if (IMPLICIT_ANY.has(diagnostic.code) && inside(admin)) return false;
    return true;
}

function describeDiagnostics(diagnostics: readonly ts.Diagnostic[]): string[] {
    return diagnostics.map(diagnostic => {
        const where = diagnostic.file && diagnostic.start !== undefined
            ? `${path.relative(REPO, diagnostic.file.fileName)}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1}`
            : "(program)";
        return `${where}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`;
    });
}

describe("the frozen legacy model accepts the whole legacy corpus", () => {
    it("finds the inputs", () => {
        expect(corpusInputs().length).toBeGreaterThan(100);
        expect(codemodInputs().length).toBeGreaterThan(15);
    });

    it("type-checks every input, strict, with no diagnostic", () => {
        const roots = [...corpusInputs(), ...codemodInputs()];
        expect(describeDiagnostics(compile(roots).filter(isModelDiagnostic))).toEqual([]);
    }, 120_000);
});
