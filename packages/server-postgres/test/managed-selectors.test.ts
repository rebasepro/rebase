import fs from "fs";
import os from "os";
import path from "path";

import { managedSelectorsForPlan, rememberManagedSelectors } from "../src/schema/managed-selectors";

let cwd: string;

beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ptah-managed-selectors-"));
});

afterEach(() => {
    fs.rmSync(cwd, {
        recursive: true,
        force: true
    });
});

function declare(selectors: string[]): void {
    const dir = path.join(cwd, ".rebase", "sql");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "ptah-managed.json"), JSON.stringify(selectors));
}

describe("Ptah managed resource history", () => {
    it("keeps a removed view selected without selecting unrelated objects", () => {
        declare(["public.tasks", "public.task_titles", "rebase_admin[type=role]"]);
        rememberManagedSelectors(cwd);

        declare(["public.tasks"]);
        expect(managedSelectorsForPlan(cwd)).toEqual(["public.tasks", "public.task_titles"]);
        rememberManagedSelectors(cwd);

        const tracked = JSON.parse(fs.readFileSync(path.join(cwd, "drizzle", "ptah-managed.json"), "utf-8"));
        expect(tracked).toEqual({
            version: 1,
            selectors: ["public.tasks", "public.task_titles"]
        });
        expect(managedSelectorsForPlan(cwd)).not.toContain("public.unrelated");
    });

    it("does not rewrite unchanged ownership", () => {
        declare(["public.tasks"]);
        rememberManagedSelectors(cwd);
        const file = path.join(cwd, "drizzle", "ptah-managed.json");
        const before = fs.statSync(file).mtimeMs;
        rememberManagedSelectors(cwd);
        expect(fs.statSync(file).mtimeMs).toBe(before);
    });

    it("fails closed on a malformed committed ownership file", () => {
        declare(["public.tasks"]);
        const file = path.join(cwd, "drizzle", "ptah-managed.json");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({
            version: 2,
            selectors: ["public.legacy"]
        }));
        expect(() => managedSelectorsForPlan(cwd)).toThrow("Invalid Ptah managed-resource manifest");
        expect(() => rememberManagedSelectors(cwd)).toThrow("Invalid Ptah managed-resource manifest");
    });
});
