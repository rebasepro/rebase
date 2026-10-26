/**
 * A fence that *declares* a real type's shape, held to the real type.
 *
 * A doc that wants to show what a type looks like often writes it out:
 *
 *     interface CronJobDefinition {
 *         name: string;
 *         schedule: string;
 *         …
 *     }
 *
 * The snippet typechecker compiles that happily — it is a declaration, and a
 * declaration is never wrong about itself. `check-api-names.mjs` sees no import
 * to check. So the fence can say anything, and it did: the 2026-10-24 sweep found
 * this the commonest drift in every slice it read, with the gate green throughout.
 * `CronJobDefinition.name` documented as required (it is optional), an invented
 * `seedDefaultRoles` on the Postgres bootstrapper options, `RebasePlugin.slots` as
 * `SlotContribution[]`, `AuthenticatedUser` without `isAnonymous` and `scopes`, a
 * `CollectionCallbacks` with six hooks out of seven, `BreadcrumbEntry.count`, a
 * `plugins` field on `RebaseCMSConfig`.
 *
 * The check: every top-level `interface X` or `type X = { … }` in a fenced block
 * whose `X` is a type a `@rebasepro/*` package exports is compared, member by
 * member, with the real declaration (resolved through the same program as the
 * name check, so barrels and re-exports work). Two findings:
 *
 *   - a member the real type does not have — invented, or renamed since;
 *   - a member whose `?` disagrees with source — documented required when it is
 *     optional, or the reverse.
 *
 * A member the doc leaves out is not a finding. Docs show the part that matters
 * on the page, and "abridged" is a legitimate shape; "wrong" is not.
 *
 * `no-verify` fences are read too. Opting out of compilation is about a fence
 * being a fragment, and a fragment that spells out a real type is as wrong as a
 * complete one — the tri-state Studio modes interface sat in exactly such a fence.
 *
 * A doc that declares a type of the *reader's* that happens to share a name with
 * one of ours marks the fence with `<!-- docs-verify: own-type -->` on the line
 * above it. Kept separate from `docs-verify: ignore`, which opts a fence out of
 * compilation for unrelated reasons.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { extractSnippets, DEFAULT_GLOBS } from "./extract.mjs";
import { loadSdkExports, PACKAGE_ENTRIES } from "./sdk-exports.mjs";

const OWN_TYPE = /<!--\s*docs-verify:\s*own-type\s*-->/;

/** `true` when the line above the fence opening carries the own-type marker. */
function markedOwnType(root, snippet, linesCache) {
    let lines = linesCache.get(snippet.file);
    if (!lines) {
        lines = readFileSync(path.join(root, snippet.file), "utf8").split("\n");
        linesCache.set(snippet.file, lines);
    }
    // snippet.line is the 1-based first body line; the opening fence is the line
    // before it and the marker the one before that.
    const above = lines[snippet.line - 3] ?? "";
    return OWN_TYPE.test(above);
}

/**
 * The real type behind an exported name, or null when the name is not a type
 * (a function, a const) or cannot be resolved.
 */
function resolveExportedType(sdk, typeName) {
    const { ts, program, checker, ownerOf } = sdk;
    const pkg = ownerOf.get(typeName);
    if (!pkg) return null;
    const sourceFile = program.getSourceFile(path.join(sdk.root, PACKAGE_ENTRIES[pkg]));
    if (!sourceFile) return null;
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) return null;
    let sym = checker.getExportsOfModule(moduleSymbol).find(s => s.getName() === typeName);
    if (!sym) return null;
    if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    const isType = sym.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Class);
    if (!isType) return null;
    const type = checker.getDeclaredTypeOfSymbol(sym);
    if (!type) return null;
    return {
        pkg,
        type
    };
}

/**
 * Members of the real type: name → optional. A union contributes the members of
 * every branch (a doc may describe any one of them), and then optionality is not
 * compared, because "optional" is not a property of a union's member.
 */
function realMembers(sdk, type) {
    const { ts, checker } = sdk;
    const branches = type.isUnion() ? type.types : [type];
    /** @type {Map<string, boolean>} */
    const members = new Map();
    let open = false;
    for (const branch of branches) {
        if (checker.getIndexInfosOfType(branch).length) open = true;
        for (const prop of checker.getPropertiesOfType(branch)) {
                    const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
            members.set(prop.getName(), (members.get(prop.getName()) ?? false) || optional);
        }
    }
    return {
        members,
        open,
        union: type.isUnion()
    };
}

/** The member list a fence writes for `name`, from an interface or a `type X = { … }`. */
function declaredShapes(ts, code) {
    const sf = ts.createSourceFile("snippet.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    /** @type {Array<{ name: string, line: number, members: Array<{ name: string, optional: boolean, line: number }> }>} */
    const shapes = [];
    const memberName = (m) => {
        if (!m.name) return null;
        if (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) return m.name.text;
        return null;
    };
    const collect = (name, node, list) => {
        const members = [];
        for (const m of list) {
            if (!ts.isPropertySignature(m) && !ts.isMethodSignature(m)) continue;
            const n = memberName(m);
            if (!n) continue;
            members.push({
                name: n,
                optional: Boolean(m.questionToken),
                line: sf.getLineAndCharacterOfPosition(m.getStart(sf)).line
            });
        }
        shapes.push({
            name,
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line,
            members
        });
    };
    for (const stmt of sf.statements) {
        if (ts.isInterfaceDeclaration(stmt)) collect(stmt.name.text, stmt, stmt.members);
        else if (ts.isTypeAliasDeclaration(stmt) && ts.isTypeLiteralNode(stmt.type)) {
            collect(stmt.name.text, stmt, stmt.type.members);
        }
    }
    return shapes;
}

/**
 * @param {string} root monorepo root: the types are resolved here.
 * @param {{ globs?: string[], docsRoot?: string }} [opts] `docsRoot` is where the
 *   globs are read from — the monorepo root, except in tests.
 */
export function checkDeclaredTypes(root, { globs = DEFAULT_GLOBS, docsRoot = root } = {}) {
    const sdk = {
        ...loadSdkExports(root),
        root
    };
    const { snippets } = extractSnippets(docsRoot, globs, { includeOptedOut: true });
    const linesCache = new Map();
    const findings = [];
    let declarations = 0;

    for (const snippet of snippets) {
        if (!/\b(interface|type)\s+[A-Z]/.test(snippet.code)) continue;
        if (path.basename(snippet.file) === "CHANGELOG.md") continue;
        const shapes = declaredShapes(sdk.ts, snippet.code);
        if (!shapes.length) continue;
        if (markedOwnType(docsRoot, snippet, linesCache)) continue;

        for (const shape of shapes) {
            const real = resolveExportedType(sdk, shape.name);
            if (!real) continue;
            declarations++;
            const { members, open, union } = realMembers(sdk, real.type);
            if (!members.size) continue;
            for (const m of shape.members) {
                if (!members.has(m.name)) {
                    if (open) continue;
                    findings.push({
                        file: snippet.file,
                        line: snippet.line + m.line,
                        type: shape.name,
                        member: m.name,
                        message:
                            `\`${shape.name}.${m.name}\` is not a member of \`${shape.name}\` (${real.pkg}). ` +
                            "Invented, or renamed since — check the real declaration."
                    });
                    continue;
                }
                if (union) continue;
                const optional = members.get(m.name);
                if (optional !== m.optional) {
                    findings.push({
                        file: snippet.file,
                        line: snippet.line + m.line,
                        type: shape.name,
                        member: m.name,
                        message: optional
                            ? `\`${shape.name}.${m.name}\` is optional in ${real.pkg}; the doc declares it required.`
                            : `\`${shape.name}.${m.name}\` is required in ${real.pkg}; the doc declares it optional (\`?\`).`
                    });
                }
            }
        }
    }

    return {
        findings,
        scanned: snippets.length,
        declarations
    };
}
