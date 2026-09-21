/**
 * Nothing reachable from `defineCollection` may *require* a React value.
 *
 * A collection file is loaded by two processes. The admin panel has React; the
 * backend has the same file and wants only the schema, so a field whose only
 * accepted form is a React value drags the whole UI layer into a process that
 * has no DOM — and in a BaaS install, no `react` on disk at all.
 *
 * This was fixed once, for one field. `EntityAction.icon` was
 * `React.ReactElement`, and the cost of that is on the record: a client app put
 * four buttons into a hand-written 316-line admin view rather than use
 * `admin.entityActions`, because declaring an action from `config/collections`
 * meant importing React there. The field is `React.ReactElement | string` now
 * and its doc comment explains why. The *class* — every other place a plain
 * value is not an accepted form — was never swept.
 *
 * So this is a guard rather than a note in a guide. It walks the type the
 * builder accepts, and fails on any property whose every union member is
 * declared by React. The rule is deliberately about *requiring*: a field may
 * name React freely as long as a string, a number or a plain object is also
 * accepted — which is what makes `React.ReactNode` fine (it includes `string`)
 * and `React.ReactElement` not.
 *
 * ### Why the compiler and not a grep
 *
 * `icon?: ReactComponentRef` names no React type at that spelling, and
 * `Field?: ComponentRef` names none at all — it is structural in core, on
 * purpose. A text search over `src` either misses those or flags them wrongly.
 * Resolving the type is the only way to ask the question that matters.
 */
import path from "node:path";
import ts from "typescript";

/** How deep into the config's type graph to walk. */
const MAX_DEPTH = 9;

/** A file that belongs to React or its typings. */
function isReactDeclaration(fileName: string): boolean {
    return /[\\/]node_modules[\\/](@types[\\/])?react(-dom)?[\\/]/.test(fileName);
}

/** A file outside this repository's sources — a dependency's typings. */
function isVendored(fileName: string): boolean {
    return fileName.includes("node_modules");
}

/** The repository root, four directories up from this package's test folder. */
const REPO_ROOT = path.resolve(__dirname, "../../..");

/**
 * The compiler options `pnpm typecheck` uses, read rather than restated.
 *
 * The `paths` in there are the reason: they resolve `@rebasepro/*` to **source**
 * instead of to `dist`, and several files in this package import their
 * siblings through the package name (`import type { AdminCollection } from
 * "@rebasepro/cms-types"`). Without the mapping the walk crosses into
 * `dist/*.d.ts` and grades the last build instead of the working tree — which
 * it did, and which meant a field fixed in `src` still failed here.
 */
function repoCompilerOptions(): ts.CompilerOptions {
    const configPath = path.join(REPO_ROOT, "tsconfig.typecheck.json");
    const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
    if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, REPO_ROOT, undefined, configPath);
    return parsed.options;
}

function declarationFiles(checker: ts.TypeChecker, type: ts.Type): string[] {
    void checker;
    const symbol = type.aliasSymbol ?? type.getSymbol();
    return (symbol?.declarations ?? []).map(d => d.getSourceFile().fileName);
}

/**
 * Whether this one type can only ever be satisfied by a React value.
 *
 * Primitives, literals and anonymous object types have no declaration in React
 * and are never React; a named type counts only if *every* declaration of it
 * lives in React's typings, so a local interface that happens to share a name
 * is not mistaken for one.
 */
function isReactType(checker: ts.TypeChecker, type: ts.Type): boolean {
    const notReact =
        ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.String | ts.TypeFlags.Number |
        ts.TypeFlags.Boolean | ts.TypeFlags.BigInt | ts.TypeFlags.StringLiteral |
        ts.TypeFlags.NumberLiteral | ts.TypeFlags.BooleanLiteral | ts.TypeFlags.BigIntLiteral |
        ts.TypeFlags.EnumLike | ts.TypeFlags.Null | ts.TypeFlags.Undefined |
        ts.TypeFlags.Void | ts.TypeFlags.Never | ts.TypeFlags.TypeParameter;
    if (type.flags & notReact) return false;

    const files = declarationFiles(checker, type);
    if (files.length === 0) return false;
    return files.every(isReactDeclaration);
}

/** The members of a union, with the absence markers dropped. */
function constituents(type: ts.Type): ts.Type[] {
    const parts = type.isUnion() ? type.types : [type];
    return parts.filter(t => !(t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)));
}

/** Whether a property's declared type admits nothing but React values. */
function requiresReact(checker: ts.TypeChecker, type: ts.Type): boolean {
    const parts = constituents(type);
    if (parts.length === 0) return false;
    return parts.every(t => isReactType(checker, t));
}

interface Finding {
    path: string;
    type: string;
}

/**
 * Walk everything an author has to supply, checking each property as it goes.
 *
 * Function *return* types are walked — a callback whose return value must be
 * React is the same problem one step removed. Parameters are not: those are
 * values the framework hands the author, so naming React in one costs the
 * backend nothing.
 *
 * Recursion stops at vendored and React types. Their own properties are not
 * this repository's to fix, and the property that *reaches* them has already
 * been checked by the time we decide not to descend.
 */
function findReactRequirements(program: ts.Program, root: ts.Type, node: ts.Node): Finding[] {
    const checker = program.getTypeChecker();
    const findings: Finding[] = [];
    const seen = new Set<ts.Type>();

    const descend = (type: ts.Type, where: string, depth: number): void => {
        if (depth > MAX_DEPTH) return;
        for (const part of constituents(type)) {
            if (seen.has(part)) continue;
            seen.add(part);
            if (isReactType(checker, part)) continue;
            if (declarationFiles(checker, part).some(isVendored)) continue;

            // Arrays and tuples: what the author puts *in* one.
            const elements = checker.isArrayType(part) || checker.isTupleType(part)
                ? checker.getTypeArguments(part as ts.TypeReference)
                : [];
            for (const element of elements) descend(element, `${where}[]`, depth + 1);

            // What a callback has to return.
            for (const signature of part.getCallSignatures()) {
                descend(signature.getReturnType(), `${where}()`, depth + 1);
            }

            for (const prop of checker.getPropertiesOfType(part)) {
                const propType = checker.getTypeOfSymbolAtLocation(prop, node);
                const at = `${where}.${prop.getName()}`;
                if (requiresReact(checker, propType)) {
                    findings.push({ path: at, type: checker.typeToString(propType) });
                    continue;
                }
                descend(propType, at, depth + 1);
            }
        }
    };

    descend(root, "collection", 0);
    return findings;
}

/**
 * A program over one in-memory file that names the type under test.
 *
 * The file is served from a path *inside* this package rather than from a temp
 * directory, and that is load-bearing: module resolution walks up from the
 * importing file to find `node_modules`, so a probe in `/tmp` resolves
 * `"react"` to nothing, every React type becomes an error type, and the walk
 * below then reports a clean sweep over types it could not see. Which is how
 * the first version of this test passed while checking nothing.
 *
 * In memory rather than on disk so a crashed run leaves no stray `.ts` file in
 * a package.
 */
function programFor(source: string): { program: ts.Program; file: ts.SourceFile } {
    const entry = path.resolve(__dirname, "..", `react-free-probe.${process.pid}.ts`);
    const options: ts.CompilerOptions = { ...repoCompilerOptions(), noEmit: true };
    const host = ts.createCompilerHost(options, true);
    const readFile = host.readFile.bind(host);
    const fileExists = host.fileExists.bind(host);
    const getSourceFile = host.getSourceFile.bind(host);
    host.readFile = name => (name === entry ? source : readFile(name));
    host.fileExists = name => (name === entry ? true : fileExists(name));
    host.getSourceFile = (name, ...rest) => name === entry
        ? ts.createSourceFile(name, source, ts.ScriptTarget.ESNext, true)
        : getSourceFile(name, ...rest);

    const program = ts.createProgram([entry], options, host);
    const file = program.getSourceFile(entry);
    if (!file) throw new Error("probe file did not compile");
    return { program, file };
}

/**
 * The probe resolved `react`, so a React type is a React type rather than an
 * error type the walk would wave through.
 *
 * Asserted per program, because that failure is silent and turns every
 * assertion here green.
 */
function assertReactResolved(program: ts.Program): void {
    const resolved = program.getSourceFiles().some(f => isReactDeclaration(f.fileName));
    if (!resolved) {
        throw new Error(
            "the probe program did not load React's typings, so nothing below can detect a React type"
        );
    }
}

/**
 * The program read this package's sources rather than its built declarations.
 *
 * The other silent failure: a probe that resolves `@rebasepro/cms-types` to
 * `dist` grades the last build, so a field fixed in `src` keeps failing and a
 * field broken in `src` keeps passing until someone rebuilds.
 */
function assertReadsSources(program: ts.Program): void {
    const files = program.getSourceFiles().map(f => f.fileName);
    const fromDist = files.filter(f => /[\\/]packages[\\/][^\\/]+[\\/]dist[\\/]/.test(f));
    if (fromDist.length > 0) {
        throw new Error(
            `the probe program resolved ${fromDist.length} workspace file(s) to dist rather than src, `
            + `starting with ${fromDist[0]} — it would grade the last build instead of the working tree`
        );
    }
}

const SRC = path.resolve(__dirname, "../src").replace(/\\/g, "/");

/** The type `defineCollection` accepts, named so the checker can be asked for it. */
const PROBE = `
import { defineCollection } from "${SRC}/define_collection";
export type Probe = Parameters<typeof defineCollection>[0];
declare const probe: Probe;
export default probe;
`;

/** A probe whose type deliberately breaks the rule, to prove the walk bites. */
const CONTROL_PROBE = `
import type React from "react";
export type Probe = {
    admin?: { nested?: { icon: React.ReactElement } };
};
declare const probe: Probe;
export default probe;
`;

function findingsFor(source: string): Finding[] {
    const { program, file } = programFor(source);
    assertReactResolved(program);
    assertReadsSources(program);
    const checker = program.getTypeChecker();
    const alias = file.statements.find(
        (s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === "Probe"
    );
    if (!alias) throw new Error("probe has no `Probe` alias");
    const type = checker.getTypeAtLocation(alias.name);
    return findReactRequirements(program, type, alias);
}

describe("a collection config never requires React", () => {
    it("finds no property whose only accepted form is a React value", () => {
        const findings = findingsFor(PROBE);

        // Printed in full rather than counted: the fix for each is to admit a
        // plain form (a Lucide icon name, a module path, a `ComponentRef`),
        // and the message has to say which field needs it.
        expect(findings.map(f => `${f.path}: ${f.type}`)).toEqual([]);
    }, 120_000);

    it("bites when a reachable field does require one, so the pass above is not vacuous", () => {
        const findings = findingsFor(CONTROL_PROBE);

        expect(findings.map(f => f.path)).toEqual(["collection.admin.nested.icon"]);
    }, 60_000);

    it("reaches the depth the real config needs, so a deep field cannot hide", () => {
        // `admin.entityActions[].icon` is four hops in, and it is the field the
        // original defect was on. If the walk stopped shallower than this, the
        // pass above would mean nothing.
        const { program, file } = programFor(PROBE);
        assertReactResolved(program);
    assertReadsSources(program);
        const checker = program.getTypeChecker();
        const alias = file.statements.find(
            (s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === "Probe"
        )!;
        const type = checker.getTypeAtLocation(alias.name);

        const visited: string[] = [];
        const findings = findReactRequirements(program, type, alias);
        void findings;
        // Walked by asking the checker the same questions the walk asks, so the
        // reachability claim is the walk's own rather than a restatement.
        const admin = type.getProperty("admin");
        expect(admin).toBeDefined();
        const adminType = checker.getTypeOfSymbolAtLocation(admin!, alias);
        for (const part of constituents(adminType)) {
            for (const prop of checker.getPropertiesOfType(part)) visited.push(prop.getName());
        }
        expect(visited).toContain("entityActions");
    }, 120_000);
});
