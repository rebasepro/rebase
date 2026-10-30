import type { CollectionConfig, EnumValues } from "@rebasepro/types";
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

/** The ids an `enum` declares, as strings. */
function enumIds(values: EnumValues): string[] {
    if (Array.isArray(values)) return values.map(entry => String(entry.id));
    return Object.keys(values);
}

function checkRoleList(value: unknown, path: string, problems: ReviewConfigProblem[]): void {
    if (value === undefined) return;
    if (!Array.isArray(value) || value.some(role => typeof role !== "string" || role.trim() === "")) {
        problems.push({ path,
message: "a role list is an array of role names, e.g. [\"agent\"]." });
    }
}

/**
 * Check one collection's review against the collection itself.
 *
 * A state-field review compiles to a policy comparing the field to
 * `pendingValue`, so the field has to exist and hold text, and every value the
 * review names has to be one the column can hold: with an `enum`, a value
 * outside it is a comparison Postgres refuses when the policy is created, and
 * a value no reviewer could ever set is the same mistake one step later.
 */
function checkCollectionReview(
    slug: string,
    review: CollectionReview,
    collection: CollectionConfig | undefined,
    problems: ReviewConfigProblem[]
): void {
    const at = `collections.${slug}`;
    if (collection === undefined) {
        problems.push({ path: at,
message: `no collection has the slug "${slug}".` });
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
message: "names the property holding the review state, e.g. \"status\"." });
        return;
    }
    if (!collection) return;
    const property = collection.properties[review.field];
    if (!property) {
        problems.push({ path: `${at}.field`,
message: `"${slug}" has no property "${review.field}". Declare it as a string, or name one it has.` });
        return;
    }
    if (property.type !== "string") {
        problems.push({ path: `${at}.field`,
message: `"${review.field}" is a ${property.type}; a review state is compared with text, so it has to be a string.` });
        return;
    }
    if (!property.enum) return;
    const allowed = enumIds(property.enum);
    for (const [key, value] of values) {
        if (typeof value === "string" && value !== "" && !allowed.includes(value)) {
            problems.push({
                path: `${at}.${key}`,
                message: `"${value}" is not one of ${review.field}'s enum values (${allowed.map(id => `"${id}"`).join(", ")}), ` +
                    "so no row could ever be in that state."
            });
        }
    }
}

/**
 * Every problem in a review configuration, checked against the collections it
 * names. Empty when the configuration is sound.
 *
 * @group Review
 */
export function findReviewConfigProblems(config: ReviewConfig, collections: readonly CollectionConfig[]): ReviewConfigProblem[] {
    const problems: ReviewConfigProblem[] = [];
    if (config.functionName !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(config.functionName)) {
        problems.push({ path: "functionName",
message: "a function name is lower-case letters, digits and dashes." });
    }
    for (const [slug, review] of Object.entries(config.collections ?? {})) {
        checkCollectionReview(slug, review, collections.find(collection => collection.slug === slug), problems);
    }
    return problems;
}

/**
 * Throw a {@link ReviewConfigError} listing every problem, or return the
 * configuration unchanged when there is none.
 *
 * @group Review
 */
export function assertReviewConfig(config: ReviewConfig, collections: readonly CollectionConfig[]): ReviewConfig {
    const problems = findReviewConfigProblems(config, collections);
    if (problems.length > 0) throw new ReviewConfigError(problems);
    return config;
}
