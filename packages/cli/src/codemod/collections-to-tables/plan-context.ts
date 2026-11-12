/**
 * What every planning step shares: where the project is, the AST, the
 * relocator, and the report being written.
 */
import path from "node:path";
import type { SourceFile } from "ts-morph";
import type { CollectionConfig } from "@rebasepro/types";

import type { AstContext, CollectionSite } from "./ast";
import { toPosix } from "./ast";
import type { Relocator } from "./modules";
import type { SplitConstant } from "./split-constants";
import type { ManualStep, Note, Refusal } from "./types";

/** One legacy collection with everything the planners read about it. */
export interface CollectionEntry {
    collection: CollectionConfig;
    /** The collection file, absolute. */
    file: string;
    /** Its AST. */
    sourceFile: SourceFile;
    /** Where its literal is, when the codemod could find it. */
    site?: CollectionSite;
    /** Why the literal could not be found, when it could not. */
    siteProblem?: string;
}

/** The shared state of one planning run. */
export interface PlanContext {
    /** The project root, absolute. */
    root: string;
    ast: AstContext;
    relocator: Relocator;
    /** The frontend app's root directory, absolute, when the project has one. */
    frontendDir?: string;
    /** Planned files: absolute path → content. */
    files: Map<string, { content: string; role: string }>;
    refusals: Refusal[];
    notes: Note[];
    manualSteps: ManualStep[];
    /** Enum constants of `config/` split into backend values and CMS labels (see `split-constants.ts`). */
    splitConstants?: SplitConstant[];
}

/** A path relative to the project root, `/`-separated. */
export function relativeToRoot(plan: PlanContext, file: string): string {
    return toPosix(path.relative(plan.root, file));
}

/** Record a refusal about one collection. */
export function refuse(plan: PlanContext, entry: CollectionEntry | undefined, reason: string, extra: { key?: string; line?: number; file?: string } = {}): void {
    plan.refusals.push({
        file: extra.file ?? (entry ? relativeToRoot(plan, entry.file) : ""),
        ...(extra.line !== undefined ? { line: extra.line } : {}),
        ...(entry ? { collection: entry.collection.slug } : {}),
        ...(extra.key !== undefined ? { key: extra.key } : {}),
        reason
    });
}

/** Record a note about one collection. */
export function note(plan: PlanContext, entry: CollectionEntry | undefined, message: string, line?: number): void {
    plan.notes.push({
        file: entry ? relativeToRoot(plan, entry.file) : "",
        ...(line !== undefined ? { line } : {}),
        ...(entry ? { collection: entry.collection.slug } : {}),
        message
    });
}

/** Plan a file, refusing a second, different content for the same path. */
export function planFile(plan: PlanContext, file: string, content: string, role: string): void {
    const existing = plan.files.get(file);
    if (existing && existing.content !== content) {
        plan.refusals.push({ file: relativeToRoot(plan, file), reason: `two outputs would be written to this path (${existing.role}; ${role}).` });
        return;
    }
    plan.files.set(file, { content, role });
}
