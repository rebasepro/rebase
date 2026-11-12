import { isTextColumnType, type ColumnDescriptor, type TableDescriptor } from "@rebasepro/types";
import { STAGED_CHANGE_OPERATIONS, type CollectionReview, type ReviewConfig } from "./types";

/** One thing wrong with a review configuration. @group Review */
export interface ReviewConfigProblem {
    /** Where it is: `collections.posts.field`. */
    path: string;
    message: string;
}

/** A review configuration the plugin cannot honour. Thrown by {@link assertReviewConfig}. @group Review */
export class ReviewConfigError extends Error {
    readonly problems: ReviewConfigProblem[];

    constructor(problems: ReviewConfigProblem[]) {
        super(`The review configuration has ${problems.length} problem(s):\n` +
            problems.map(problem => `  - ${problem.path}: ${problem.message}`).join("\n"));
        this.name = "ReviewConfigError";
        this.problems = problems;
    }
}

/** The closed value set a column holds — its Postgres enum's labels, or its `.oneOf([...])` — as strings. */
function closedValues(column: ColumnDescriptor): string[] | undefined {
    if (column.type.kind === "enum") return [...column.type.values];
    return column.oneOf?.map(String);
}

/** Whether a column holds text a review state can be compared with: a text kind, or a Postgres enum. */
function holdsText(column: ColumnDescriptor): boolean {
    return isTextColumnType(column.type) || column.type.kind === "enum";
}

function checkRoleList(value: unknown, path: string, problems: ReviewConfigProblem[]): void {
    if (value === undefined) return;
    if (!Array.isArray(value) || value.some(role => typeof role !== "string" || role.trim() === "")) {
        problems.push({ path,
message: "a role list is an array of role names, e.g. [\"agent\"]." });
    }
}

/**
 * Check one table's review against the table's descriptor.
 *
 * A state-field review compiles to a policy comparing the field to
 * `pendingValue`, so the field has to exist and hold text, and every value the
 * review names has to be one the column can hold: with an `enum`, a value
 * outside it is a comparison Postgres refuses when the policy is created, and
 * a value no reviewer could ever set is the same mistake one step later.
 */
function checkTableReview(
    slug: string,
    review: CollectionReview,
    table: TableDescriptor | undefined,
    problems: ReviewConfigProblem[]
): void {
    const at = `collections.${slug}`;
    if (table === undefined) {
        problems.push({ path: at,
message: `no table has the slug "${slug}". Declare it with defineTable in backend/schema, or name one there is.` });
    }
    checkRoleList(review.agentRoles, `${at}.agentRoles`, problems);
    checkRoleList(review.reviewerRoles, `${at}.reviewerRoles`, problems);

    if (review.mode === "staged-table") {
        const operations = review.operations;
        if (operations !== undefined && (!Array.isArray(operations) || operations.length === 0 ||
            operations.some(op => !STAGED_CHANGE_OPERATIONS.includes(op)))) {
            problems.push({ path: `${at}.operations`,
message: "a non-empty list of \"insert\", \"update\" and \"delete\"." });
        }
        return;
    }
    if (review.mode !== "state-field") {
        problems.push({ path: `${at}.mode`,
message: `"${String(Reflect.get(review, "mode"))}" is not a mode: use "state-field" or "staged-table".` });
        return;
    }

    const values: [string, unknown][] = [["pendingValue", review.pendingValue], ["approvedValue", review.approvedValue]];
    if (review.rejectedValue !== undefined) values.push(["rejectedValue", review.rejectedValue]);
    for (const [key, value] of values) {
        if (typeof value !== "string" || value === "") {
            problems.push({ path: `${at}.${key}`,
message: `a non-empty string: the value '${review.field}' holds in that state.` });
        }
    }
    if (review.pendingValue === review.approvedValue) {
        problems.push({ path: `${at}.approvedValue`,
message: "the same as pendingValue, so approving a row would change nothing." });
    }

    if (typeof review.field !== "string" || review.field === "") {
        problems.push({ path: `${at}.field`,
message: "names the column holding the review state, e.g. \"status\"." });
        return;
    }
    if (!table) return;
    const column = table.columns.find(candidate => candidate.key === review.field);
    if (!column) {
        problems.push({ path: `${at}.field`,
message: `"${slug}" has no column "${review.field}". Declare it as a text column (col.text()), or name one it has.` });
        return;
    }
    if (!holdsText(column)) {
        problems.push({ path: `${at}.field`,
message: `"${review.field}" is a ${column.type.kind} column; a review state is compared with text, so it has to hold text (col.text(), col.varchar() or col.enum()).` });
        return;
    }
    const allowed = closedValues(column);
    if (!allowed) return;
    for (const [key, value] of values) {
        if (typeof value === "string" && value !== "" && !allowed.includes(value)) {
            problems.push({
                path: `${at}.${key}`,
                message: `"${value}" is not one of ${review.field}'s values (${allowed.map(id => `"${id}"`).join(", ")}), ` +
                    "so no row could ever be in that state."
            });
        }
    }
}

/**
 * Every problem in a review configuration, checked against the descriptors
 * of the tables it names (`services.tables()` on the backend, or
 * `compileTables(...)`). Empty when the configuration is sound.
 *
 * @group Review
 */
export function findReviewConfigProblems(config: ReviewConfig, tables: readonly TableDescriptor[]): ReviewConfigProblem[] {
    const problems: ReviewConfigProblem[] = [];
    if (config.functionName !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(config.functionName)) {
        problems.push({ path: "functionName",
message: "a function name is lower-case letters, digits and dashes." });
    }
    for (const [slug, review] of Object.entries(config.collections ?? {})) {
        checkTableReview(slug, review, tables.find(table => table.slug === slug), problems);
    }
    return problems;
}

/**
 * Throw a {@link ReviewConfigError} listing every problem, or return the
 * configuration unchanged when there is none.
 *
 * @group Review
 */
export function assertReviewConfig(config: ReviewConfig, tables: readonly TableDescriptor[]): ReviewConfig {
    const problems = findReviewConfigProblems(config, tables);
    if (problems.length > 0) throw new ReviewConfigError(problems);
    return config;
}
