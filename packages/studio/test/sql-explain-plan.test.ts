import { describe, expect, it } from "@jest/globals";
import { exclusiveTime, explainResultOfRows, nodeBuffers, readExplainResult, slowestNodes, type ExplainPlanNode } from "../src/utils/explain_plan";
import { buildExplainAnalyzeScript, buildExplainSql } from "../src/utils/sql_utils";

/**
 * EXPLAIN in the SQL console: the script that times a statement in a
 * transaction it rolls back, and the reading of the plan that comes back —
 * each node's own time, and the slowest of them.
 */

const node = (type: string, total: number, loops: number, plans: ExplainPlanNode[] = []): ExplainPlanNode => ({
    "Node Type": type,
    "Startup Cost": 0,
    "Total Cost": 1,
    "Plan Rows": 1,
    "Plan Width": 4,
    "Actual Total Time": total,
    "Actual Loops": loops,
    Plans: plans
});

describe("the EXPLAIN ANALYZE script", () => {
    it("wraps one statement in a transaction it rolls back", () => {
        expect(buildExplainAnalyzeScript("DELETE FROM posts WHERE id = 1;")).toBe(
            "BEGIN;\nEXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) DELETE FROM posts WHERE id = 1\n;\nROLLBACK;"
        );
    });

    it("ends a statement whose last line is a comment on a line of its own", () => {
        const script = buildExplainAnalyzeScript("SELECT 1 -- why");
        expect(script).toBe("BEGIN;\nEXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT 1 -- why\n;\nROLLBACK;");
    });

    it("refuses more than one statement, which would run inside the transaction or end it", () => {
        expect(buildExplainAnalyzeScript("SELECT 1; COMMIT")).toBeNull();
        expect(buildExplainAnalyzeScript("   ")).toBeNull();
        expect(buildExplainSql("SELECT 1; DELETE FROM t")).toBeNull();
    });
});

describe("reading a plan", () => {
    const analyzed = [{ Plan: node("Hash Join", 10, 1, [node("Seq Scan", 2, 1), node("Index Scan", 0.5, 10)]), "Planning Time": 0.2, "Execution Time": 10.4 }];

    it("reads the JSON text the script door returns, and the array an admin read parses", () => {
        const fromText = readExplainResult(JSON.stringify(analyzed));
        expect(fromText).toMatchObject({ planningTime: 0.2, executionTime: 10.4, analyzed: true });
        expect(fromText?.plan["Node Type"]).toBe("Hash Join");
        expect(readExplainResult(analyzed)?.plan["Node Type"]).toBe("Hash Join");
        expect(explainResultOfRows([{ "QUERY PLAN": analyzed }])?.analyzed).toBe(true);
    });

    it("is not a plan for any other value", () => {
        expect(readExplainResult("not json")).toBeNull();
        expect(readExplainResult([{ Plan: { "Node Type": "x" } }])).toBeNull();
        expect(explainResultOfRows([{ a: 1 }])).toBeNull();
        expect(explainResultOfRows([{ "QUERY PLAN": analyzed }, { "QUERY PLAN": analyzed }])).toBeNull();
    });

    it("says a plan that did not run was not analyzed", () => {
        const planned = [{ Plan: { "Node Type": "Seq Scan", "Startup Cost": 0, "Total Cost": 3, "Plan Rows": 1, "Plan Width": 4 } }];
        expect(readExplainResult(planned)?.analyzed).toBe(false);
        expect(slowestNodes(planned[0].Plan)).toEqual([]);
    });

    it("counts a node's own time over its loops, less its children's", () => {
        const [scan, index] = analyzed[0].Plan.Plans!;
        // 10 − (2 × 1 + 0.5 × 10)
        expect(exclusiveTime(analyzed[0].Plan)).toBe(3);
        expect(exclusiveTime(index)).toBe(5);
        expect(exclusiveTime(scan)).toBe(2);
        expect(slowestNodes(analyzed[0].Plan).map(entry => entry["Node Type"])).toEqual(["Index Scan", "Hash Join", "Seq Scan"]);
        expect(slowestNodes(analyzed[0].Plan, 1)).toHaveLength(1);
    });

    it("marks no node that took less than a twentieth of the run", () => {
        const plan = node("Sort", 41.5, 1, [node("Function Scan", 41.3, 1)]);
        expect(slowestNodes(plan).map(entry => entry["Node Type"])).toEqual(["Function Scan"]);
    });

    it("never counts negative time for a parallel node whose workers add up to more", () => {
        expect(exclusiveTime(node("Gather", 5, 1, [node("Parallel Seq Scan", 4, 3)]))).toBe(0);
    });

    it("reads the buffers a node touched, and none when BUFFERS was not asked for", () => {
        expect(nodeBuffers({ ...node("Seq Scan", 1, 1), "Shared Hit Blocks": 4, "Shared Read Blocks": 2, "Temp Written Blocks": 1 }))
            .toEqual({ hit: 4, read: 2, dirtied: 0, written: 0, temp: 1 });
        expect(nodeBuffers(node("Seq Scan", 1, 1))).toBeNull();
    });
});
