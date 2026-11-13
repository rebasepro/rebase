/**
 * Row-shaped admin hands: custom views, entity actions, display resolvers and
 * additional fields receive `{ row, id }` on 0.31, not the `entity` view model
 * (`entity.values.x`, `entity.id`). A function that destructures `({ entity })`
 * reads `undefined` at run time — and where it is untyped (a carried
 * customization, a component on a loose prop type) no type check says so.
 *
 * Found in the project's frontend code as the run leaves it — a parameter typed
 * with one of the slot prop types, or a function written in a customization's
 * `entityActions` / `entityViews` / `display` / `additionalFields` — each is
 * rewritten when its body reads `entity` only as `entity.values.x`,
 * `entity.values` or `entity.id` (`row.x`, `row`, `id`), and listed in one
 * grouped step with its file and line otherwise.
 */
import fs from "node:fs";
import path from "node:path";
import type { Node, ObjectBindingPattern } from "ts-morph";

import type { PlanContext } from "./plan-context";
import { relativeToRoot } from "./plan-context";

/** The prop types of the slots that take a row: a parameter typed with one is a row-shaped hand. */
const SLOT_TYPES = /\b(EntityCustomViewParams|EntityActionClickProps|AdditionalFieldDelegateProps|TableDisplayResolver|EntityCustomView|EntityAction|TableEntityAction|TableEntityView|TableAdditionalField)\b/;

/** The customization keys whose functions take a row. */
const SLOT_KEYS = new Set(["entityActions", "entityViews", "display", "additionalFields"]);

const SOURCE = /\.(ts|tsx|js|jsx|mts|mjs)$/;
const IGNORED = new Set(["node_modules", "dist", "build", "generated", ".git", "coverage"]);

/** Whether a function is a slot's: typed with a slot prop type, or written under a slot key of a customization. */
function isSlotFunction(plan: PlanContext, fn: Node, pattern: ObjectBindingPattern): boolean {
    const { Node: N } = plan.ast.tsm;
    const parameter = pattern.getParent();
    if (N.isParameterDeclaration(parameter) && SLOT_TYPES.test(parameter.getTypeNode()?.getText() ?? "")) return true;
    const holder = fn.getParent();
    if (holder && N.isVariableDeclaration(holder) && SLOT_TYPES.test(holder.getTypeNode()?.getText() ?? "")) return true;
    for (const ancestor of fn.getAncestors()) {
        if (N.isPropertyAssignment(ancestor) && SLOT_KEYS.has(ancestor.getName())) return true;
        if (N.isCallExpression(ancestor) && /^(customizeTable|defineFirestoreCollection)$/.test(ancestor.getExpression().getText())) break;
    }
    return false;
}

interface Found {
    file: string;
    line: number;
    rewritten: boolean;
}

/**
 * Rewrite or list the row-shaped hands in the frontend (planned contents first).
 *
 * @returns nothing; planned files are updated and one grouped step is pushed
 */
export function planRowShapedHands(plan: PlanContext, frontendDir: string): void {
    const { Node: N, SyntaxKind } = plan.ast.tsm;
    const files = new Set<string>();
    const walk = (dir: string): void => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith(".") || IGNORED.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (SOURCE.test(entry.name) && !entry.name.endsWith(".d.ts")) files.add(full);
        }
    };
    walk(frontendDir);
    for (const file of plan.files.keys()) if (SOURCE.test(file) && !path.relative(frontendDir, file).startsWith("..")) files.add(file);
    const found: Found[] = [];
    for (const file of [...files].sort()) {
        const planned = plan.files.get(file);
        const text = planned ? planned.content : fs.readFileSync(file, "utf8");
        if (!/\bentity\b/.test(text)) continue;
        const sf = plan.ast.project.createSourceFile(`/__rebase_migrate__/row-hands-${path.basename(file)}`, text, { overwrite: true });
        const edits: { start: number; end: number; text: string }[] = [];
        try {
            for (const pattern of sf.getDescendantsOfKind(SyntaxKind.ObjectBindingPattern)) {
                const parameter = pattern.getParent();
                if (!N.isParameterDeclaration(parameter)) continue;
                const fn = parameter.getParent();
                if (!fn || !(N.isArrowFunction(fn) || N.isFunctionExpression(fn) || N.isFunctionDeclaration(fn) || N.isMethodDeclaration(fn))) continue;
                if (fn.getParameters()[0] !== parameter) continue;
                const element = pattern.getElements().find(candidate => (candidate.getPropertyNameNode()?.getText() ?? candidate.getName()) === "entity");
                if (!element || !isSlotFunction(plan, fn, pattern)) continue;
                const line = parameter.getStartLineNumber();
                const body = fn.getBody();
                const others = pattern.getElements().filter(candidate => candidate !== element).map(candidate => candidate.getName());
                // Mechanical only for a plain `entity` binding read as entity.values.x / entity.values / entity.id.
                const uses = body ? body.getDescendantsOfKind(SyntaxKind.Identifier).filter(identifier => identifier.getText() === "entity" &&
                    !(N.isPropertyAccessExpression(identifier.getParent()) && identifier.getParentOrThrow().getChildAtIndex(2) === identifier) &&
                    !(N.isPropertyAssignment(identifier.getParent()) && identifier.getParentOrThrow().getChildAtIndex(0) === identifier)) : [];
                const replacements: { start: number; end: number; text: string }[] = [];
                let needsRow = false;
                let needsId = false;
                let mechanical = element.getPropertyNameNode() === undefined && element.getInitializer() === undefined && !element.getDotDotDotToken() && body !== undefined &&
                    !others.includes("row") && !others.includes("id");
                for (const use of uses) {
                    if (!mechanical) break;
                    const access = use.getParent();
                    if (!access || !N.isPropertyAccessExpression(access) || access.getExpression() !== use) {
                        mechanical = false;
                        break;
                    }
                    if (access.getName() === "id") {
                        needsId = true;
                        replacements.push({ start: access.getStart(), end: access.getEnd(), text: "id" });
                    } else if (access.getName() === "values") {
                        needsRow = true;
                        replacements.push({ start: access.getStart(), end: access.getEnd(), text: "row" });
                    } else {
                        mechanical = false;
                    }
                }
                // `row` / `id` already meaning something else in the body would be captured.
                if (mechanical && body) {
                    const bodyText = body.getText();
                    const stripped = bodyText.replace(/\bentity\.(values|id)\b/g, "");
                    if ((needsRow && /\brow\b/.test(stripped)) || (needsId && /\bid\b/.test(stripped))) mechanical = false;
                }
                if (mechanical && uses.length > 0) {
                    const names = [...(needsRow ? ["row"] : []), ...(needsId ? ["id"] : [])];
                    edits.push({ start: element.getStart(), end: element.getEnd(), text: names.join(", ") }, ...replacements);
                    found.push({ file, line, rewritten: true });
                } else {
                    found.push({ file, line, rewritten: false });
                }
            }
        } finally {
            plan.ast.project.removeSourceFile(sf);
        }
        if (edits.length > 0) {
            let next = text;
            for (const edit of edits.sort((a, b) => b.start - a.start)) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
            plan.files.set(file, { content: next, role: planned ? `${planned.role}, row-shaped hands` : `row-shaped hands (${relativeToRoot(plan, file)})` });
        }
    }
    const byHand = found.filter(entry => !entry.rewritten);
    const rewritten = found.filter(entry => entry.rewritten);
    if (rewritten.length > 0) {
        plan.notes.push({
            file: "",
            message: `${rewritten.length} custom view / entity action / display resolver / additional field function(s) destructured \`({ entity })\` and read only \`entity.values.x\` / \`entity.id\`: rewritten to \`({ row, id })\` (\`row.x\`, \`id\`) — ${rewritten.map(entry => `${relativeToRoot(plan, entry.file)}:${entry.line}`).join(", ")}.`
        });
    }
    if (byHand.length > 0) {
        plan.manualSteps.push({
            title: "Make the admin hands row-shaped",
            detail: `Custom views, entity actions, display resolvers and additional fields receive \`{ row, id }\` on 0.31, not \`entity\`: \`({ entity }) => entity.values.title\` reads undefined (and untyped, no type check says so). Write \`({ row, id }) => row.title\` — \`row\` is the record as the server sends it (dates as ISO strings, a belongsTo as its foreign-key column), \`id\` its primary key as a string; a view's unsaved edits are \`modifiedValues\`. These read \`entity\` in a way the codemod does not rewrite: ${byHand.map(entry => `${relativeToRoot(plan, entry.file)}:${entry.line}`).join(", ")}.`
        });
    }
}
