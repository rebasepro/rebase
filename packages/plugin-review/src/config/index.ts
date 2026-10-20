/**
 * `@rebasepro/plugin-review/config` — what a review is, with no runtime
 * attached: the configuration types, the policy a state-field review compiles
 * to, the checks a configuration must pass, and the diff a reviewer reads.
 *
 * Safe to import from a collection file, which the backend and the admin
 * panel both load.
 *
 * @module
 */
export * from "./types";
export { reviewSecurityRules } from "./rules";
export { isReviewer, mayPropose, scopeForOperation } from "./access";
export { findReviewConfigProblems, assertReviewConfig, ReviewConfigError } from "./validate";
export type { ReviewConfigProblem } from "./validate";
export { diffStagedChange } from "./diff";
export type { FieldChange, FieldChangeKind } from "./diff";
