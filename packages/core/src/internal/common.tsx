/**
 * Layout width primitives used by the framework's own side-panel and form
 * dialog sizing logic.
 *
 * @internal Not part of the stable public API — exported only because
 * `@rebasepro/admin` and `@rebasepro/studio` need them to compute the same
 * dialog widths as the framework. Do not depend on these for app code; they
 * may change shape or be removed without a major version bump.
 */
export const CONTAINER_FULL_WIDTH = "100vw";

/** @internal See {@link CONTAINER_FULL_WIDTH}. */
export const ADDITIONAL_TAB_WIDTH = "55vw";

/** @internal See {@link CONTAINER_FULL_WIDTH}. */
export const FORM_CONTAINER_WIDTH = "768px";
