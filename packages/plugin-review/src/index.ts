/**
 * `@rebasepro/plugin-review` — the admin half of the review queue.
 *
 * - `useReviewPlugin(config)` puts a review queue on every reviewed collection.
 * - `@rebasepro/plugin-review/server` is the function agents propose through.
 * - `@rebasepro/plugin-review/config` is what both read: the configuration
 *   types, and the policy a state-field review compiles to.
 *
 * @module
 */
export { useReviewPlugin } from "./useReviewPlugin";
export { ReviewQueueButton } from "./components/ReviewQueueButton";
export { ReviewQueueView, ReviewQueueList, StagedChangeHeader } from "./components/ReviewQueueView";
export type { ReviewQueueItem } from "./components/ReviewQueueView";
export { StagedChangeDiff, formatReviewValue } from "./components/StagedChangeDiff";
export { useReviewApi, readStagedChange, ReviewRequestError } from "./hooks/useReviewApi";
export type { ReviewApi, ReviewRow } from "./hooks/useReviewApi";
export { useReviewTranslation, REVIEW_TRANSLATIONS } from "./i18n";
export type { ReviewTranslationKey, ReviewTranslations } from "./i18n";
export * from "./config";
