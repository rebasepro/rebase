/**
 * Reading an `EXPLAIN (FORMAT JSON)` result — with or without `ANALYZE` —
 * into what the plan view draws: the plan tree, the run's planning and
 * execution time, and how much of the time each node spent on its own.
 */

/** One node of a plan, as `EXPLAIN (FORMAT JSON)` writes it. Only the fields the view reads are named. */
export interface ExplainPlanNode {
    "Node Type": string;
    "Relation Name"?: string;
    "Alias"?: string;
    "Startup Cost": number;
    "Total Cost": number;
    "Plan Rows": number;
    "Plan Width": number;
    "Actual Startup Time"?: number;
    "Actual Total Time"?: number;
    "Actual Rows"?: number;
    "Actual Loops"?: number;
    "Shared Hit Blocks"?: number;
    "Shared Read Blocks"?: number;
    "Shared Dirtied Blocks"?: number;
    "Shared Written Blocks"?: number;
    "Temp Read Blocks"?: number;
    "Temp Written Blocks"?: number;
    "Filter"?: string;
    "Rows Removed by Filter"?: number;
    "Index Cond"?: string;
    "Hash Cond"?: string;
    "Plans"?: ExplainPlanNode[];
    [key: string]: unknown;
}

/** A whole explained statement. */
export interface ExplainResult {
    plan: ExplainPlanNode;
    /** Present for `ANALYZE`: milliseconds. */
    planningTime?: number;
    executionTime?: number;
    /** The node was timed: the statement ran (`ANALYZE`). */
    analyzed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlanNode(value: unknown): value is ExplainPlanNode {
    return isRecord(value) && typeof value["Node Type"] === "string"
        && typeof value["Total Cost"] === "number" && typeof value["Startup Cost"] === "number";
}

/**
 * The plan in a result's `QUERY PLAN` value — an array (an admin read parses
 * json) or the JSON text the console's script door returns — or `null` when
 * the value is not one.
 */
export function readExplainResult(value: unknown): ExplainResult | null {
    let parsed = value;
    if (typeof value === "string") {
        try {
            parsed = JSON.parse(value);
        } catch {
            return null;
        }
    }
    const entry: unknown = Array.isArray(parsed) ? parsed[0] : undefined;
    if (!isRecord(entry) || !isPlanNode(entry.Plan)) return null;
    const plan = entry.Plan;
    return {
        plan,
        planningTime: typeof entry["Planning Time"] === "number" ? entry["Planning Time"] : undefined,
        executionTime: typeof entry["Execution Time"] === "number" ? entry["Execution Time"] : undefined,
        analyzed: typeof plan["Actual Total Time"] === "number"
    };
}

/** The `QUERY PLAN` cell of a result, when the rows are a single plan. */
export function explainResultOfRows(rows: readonly Record<string, unknown>[] | null): ExplainResult | null {
    if (!rows || rows.length !== 1 || !("QUERY PLAN" in rows[0])) return null;
    return readExplainResult(rows[0]["QUERY PLAN"]);
}

/**
 * Milliseconds the node spent on its own, over all its loops: its total time
 * less its children's. Postgres reports `Actual Total Time` per loop, so each
 * is multiplied by its loops first. Never below zero — a parallel node's
 * children can add up to more than it, timed on other workers.
 */
export function exclusiveTime(node: ExplainPlanNode): number {
    const total = (node["Actual Total Time"] ?? 0) * (node["Actual Loops"] ?? 1);
    const children = (node.Plans ?? []).reduce(
        (sum, child) => sum + (child["Actual Total Time"] ?? 0) * (child["Actual Loops"] ?? 1),
        0
    );
    return Math.max(0, total - children);
}

/**
 * The nodes that took the most time of their own, slowest first: at most
 * `count`, and only ones that took at least `minShare` of the whole run — a
 * sort that took a fraction of a millisecond beside a 40 ms scan is not one of
 * "the slowest" however few nodes there are. Empty for a plan that did not run.
 */
export function slowestNodes(plan: ExplainPlanNode, count = 3, minShare = 0.05): ExplainPlanNode[] {
    const nodes: ExplainPlanNode[] = [];
    const visit = (node: ExplainPlanNode) => {
        nodes.push(node);
        node.Plans?.forEach(visit);
    };
    visit(plan);
    const total = (plan["Actual Total Time"] ?? 0) * (plan["Actual Loops"] ?? 1);
    return nodes
        .filter(node => typeof node["Actual Total Time"] === "number" && exclusiveTime(node) > 0 && exclusiveTime(node) >= total * minShare)
        .sort((a, b) => exclusiveTime(b) - exclusiveTime(a))
        .slice(0, count);
}

/** The shared and temp blocks a node touched, as `BUFFERS` reports them; `null` when it reported none. */
export function nodeBuffers(node: ExplainPlanNode): { hit: number; read: number; dirtied: number; written: number; temp: number } | null {
    const fields = ["Shared Hit Blocks", "Shared Read Blocks", "Shared Dirtied Blocks", "Shared Written Blocks", "Temp Read Blocks", "Temp Written Blocks"] as const;
    if (!fields.some(field => typeof node[field] === "number")) return null;
    return {
        hit: node["Shared Hit Blocks"] ?? 0,
        read: node["Shared Read Blocks"] ?? 0,
        dirtied: node["Shared Dirtied Blocks"] ?? 0,
        written: node["Shared Written Blocks"] ?? 0,
        temp: (node["Temp Read Blocks"] ?? 0) + (node["Temp Written Blocks"] ?? 0)
    };
}
