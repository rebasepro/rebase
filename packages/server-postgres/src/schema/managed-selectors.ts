import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

import { generatedSqlDir } from "../generated-sql";

const TRACKED_SELECTORS = path.join("drizzle", "ptah-managed.json");

function parseSelectors(value: unknown, file: string, allowEmpty = false): string[] {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
        throw new Error(`Invalid Ptah managed-resource manifest: ${file}`);
    }
    const selectors: string[] = [];
    for (const selector of value) {
        if (typeof selector !== "string" || selector.length === 0) {
            throw new Error(`Invalid Ptah managed-resource manifest: ${file}`);
        }
        selectors.push(selector);
    }
    return selectors;
}

function currentSelectors(cwd: string): string[] {
    const file = path.join(generatedSqlDir(cwd), "ptah-managed.json");
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
    return parseSelectors(parsed, file);
}

function trackedSelectors(cwd: string): string[] {
    const file = path.join(cwd, TRACKED_SELECTORS);
    if (!fs.existsSync(file)) return [];
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (typeof parsed !== "object" || parsed === null || !("version" in parsed) ||
        parsed.version !== 1 || !("selectors" in parsed)) {
        throw new Error(`Invalid Ptah managed-resource manifest: ${file}`);
    }
    return parseSelectors(parsed.selectors, file, true);
}

/** Select the current declarations and previously declared objects so removals plan a DROP. */
export function managedSelectorsForPlan(cwd: string = process.cwd()): string[] {
    return [...new Set([...currentSelectors(cwd), ...trackedSelectors(cwd)])];
}

/** Keep ownership across generations; the scratch SQL directory is ignored by Git. */
export function rememberManagedSelectors(cwd: string = process.cwd()): void {
    const file = path.join(cwd, TRACKED_SELECTORS);
    // Roles are server-wide bootstrap resources. A policy no longer naming one
    // must not turn that role into a DROP ROLE on a shared PostgreSQL server.
    const selectors = [...new Set([...trackedSelectors(cwd), ...currentSelectors(cwd)])]
        .filter(selector => !selector.endsWith("[type=role]"));
    const contents = JSON.stringify({
        version: 1,
        selectors
    }, null, 2) + "\n";
    if (fs.existsSync(file) && fs.readFileSync(file, "utf-8") === contents) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporary, contents);
        fs.renameSync(temporary, file);
    } finally {
        if (fs.existsSync(temporary)) fs.rmSync(temporary);
    }
}
