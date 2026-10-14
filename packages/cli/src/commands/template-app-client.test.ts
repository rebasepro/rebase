/**
 * The scaffold's admin builds one client per page.
 *
 * `frontend/src/App.tsx` created its client in `React.useMemo` inside `App`,
 * and `main.tsx` mounts `App` under `<React.StrictMode>`. In development
 * StrictMode calls a `useMemo` factory twice, so every dev load built two
 * clients: both restored the session on load (two `POST /api/auth/refresh`,
 * two 401s in the console for a visitor who never signed in), both scheduled
 * their timers, and nothing ever closed the one React threw away.
 *
 * A client created where the module is evaluated exists once per page,
 * whatever React does with the component. That is what this holds the
 * template to: one `createRebaseClient(…)` call, at module scope.
 *
 * The repository's example app (`app/frontend`) is the running copy of the
 * same entry point, and the one the demo and the admin e2e load. It has no
 * test runner of its own, so it is held to the same rule here.
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(here, "..", "..", "templates", "template", "frontend", "src", "App.tsx");
const EXAMPLE_APP = path.resolve(here, "..", "..", "..", "..", "app", "frontend", "src", "App.tsx");

/** Every `createRebaseClient(…)` call in the file, with whether a function encloses it. */
function clientCalls(fileName: string): { insideFunction: boolean }[] {
    const file = ts.createSourceFile(fileName, fs.readFileSync(fileName, "utf-8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const calls: { insideFunction: boolean }[] = [];
    const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "createRebaseClient") {
            let insideFunction = false;
            for (let parent = node.parent; parent; parent = parent.parent) {
                if (ts.isFunctionLike(parent)) {
                    insideFunction = true;
                    break;
                }
            }
            calls.push({ insideFunction });
        }
        ts.forEachChild(node, visit);
    };
    visit(file);
    return calls;
}

describe("an admin entry point", () => {
    it.each([
        ["the scaffold's App.tsx", APP],
        ["the example app's App.tsx", EXAMPLE_APP]
    ])("%s creates its client once, at module scope, not inside a component", (_name, fileName) => {
        const calls = clientCalls(fileName);
        expect(calls).toHaveLength(1);
        expect(calls[0].insideFunction).toBe(false);
    });
});
