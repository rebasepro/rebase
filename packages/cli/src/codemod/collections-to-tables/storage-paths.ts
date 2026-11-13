/**
 * A storage property whose `storagePath` is a function.
 *
 * On 0.30 the panel called the function to choose where an upload goes, and
 * the server enforced the property's `maxSize` / `acceptedFiles` only for an
 * upload that named the property (a function path claimed no keys). On 0.31
 * the split is explicit: the panel's function is the customization's
 * `storage.path`, and the column's `path` template is where the server
 * enforces the limits for any upload landing there — in addition to an upload
 * that names the column.
 *
 * So the column needs a template that claims exactly the keys the function
 * produces. When the function returns one template literal (or string), the
 * template is its static text with each interpolation as `{path}` (any number
 * of segments — an interpolated value may hold a `/`): `` `${owner}/cv` ``
 * → `{path}/cv`, which matches every key the function can write and keys of
 * that same shape only. With no static text at all (or a function the codemod
 * cannot read), no template would be faithful: the lift refuses it, with what
 * to write.
 */
import type { LiftNote, LegacyCollectionConfig } from "@rebasepro/common/migrate";

import { nodeAtPath, unwrap } from "./ast";
import type { CollectionEntry, PlanContext } from "./plan-context";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The template a storage-path function's single returned template literal stands for, or undefined. */
function templateOf(plan: PlanContext, entry: CollectionEntry, key: string): string | undefined {
    const { Node: N, SyntaxKind } = plan.ast.tsm;
    const site = entry.site;
    if (!site) return undefined;
    const located = nodeAtPath(plan.ast, site.literal, ["properties", key, "storage", "storagePath"]);
    if (!located.node) return undefined;
    const fn = located.node.method ?? (located.node.value ? unwrap(plan.ast, located.node.value) : undefined);
    if (!fn || !(N.isArrowFunction(fn) || N.isFunctionExpression(fn) || N.isMethodDeclaration(fn))) return undefined;
    let returned;
    const body = fn.getBody();
    if (body && !N.isBlock(body)) returned = body;
    else {
        const returns = fn.getDescendantsOfKind(SyntaxKind.ReturnStatement).filter(statement =>
            statement.getFirstAncestor(ancestor => N.isArrowFunction(ancestor) || N.isFunctionExpression(ancestor) || N.isFunctionDeclaration(ancestor) || N.isMethodDeclaration(ancestor)) === fn);
        if (returns.length !== 1) return undefined;
        returned = returns[0].getExpression();
    }
    if (!returned) return undefined;
    const value = unwrap(plan.ast, returned);
    let template: string;
    if (N.isStringLiteral(value) || N.isNoSubstitutionTemplateLiteral(value)) template = value.getLiteralValue();
    else if (N.isTemplateExpression(value)) {
        template = value.getHead().getLiteralText() + value.getTemplateSpans().map(span => `{path}${span.getLiteral().getLiteralText()}`).join("");
    } else return undefined;
    // Only static text decides what the template claims: none at all would claim every key.
    if (!/[^/{}]/.test(template.replace(/\{path\}/g, ""))) return undefined;
    return template;
}

/**
 * Replace each derivable function `storagePath` of the evaluated collections
 * with its template, and return the functions as lift notes (`browser`), so
 * the customization carries them as `storage.path`.
 */
export function deriveStoragePaths(plan: PlanContext, entries: readonly CollectionEntry[]): LiftNote[] {
    const notes: LiftNote[] = [];
    for (const entry of entries) {
        const collection: LegacyCollectionConfig = entry.collection;
        const properties: unknown = collection.properties;
        if (!isRecord(properties)) continue;
        for (const [key, property] of Object.entries(properties)) {
            if (!isRecord(property) || !isRecord(property.storage)) continue;
            const storagePath = property.storage.storagePath;
            if (typeof storagePath !== "function") continue;
            const template = templateOf(plan, entry, key);
            if (template === undefined) continue;
            property.storage = { ...property.storage, storagePath: template };
            notes.push({
                collection: collection.slug,
                key,
                field: "storage.storagePath",
                kind: "browser",
                valueKind: "function",
                value: storagePath,
                reason: `A function the panel calls to choose the upload path; the column's \`path\` is "${template}", the keys it produces, where the server enforces the limits.`
            });
        }
    }
    return notes;
}
