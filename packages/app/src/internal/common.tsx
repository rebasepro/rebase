/**
 * Layout width primitives used by the framework's own side-panel and form
 * dialog sizing logic.
 *
 * @internal Not part of the stable public API — exported only because
 * `@rebasepro/cms` and `@rebasepro/studio` need them to compute the same
 * dialog widths as the framework. Do not depend on these for app code; they
 * may change shape or be removed without a major version bump.
 */
export const CONTAINER_FULL_WIDTH = "100vw";

/** @internal See {@link CONTAINER_FULL_WIDTH}. */
export const FORM_CONTAINER_WIDTH = "768px";

/**
 * How wide the side panel opens when neither the caller nor the collection
 * says otherwise.
 *
 * Sized from what it has to hold rather than from a round number: the form's
 * content column plus its metadata rail plus gutters, which is also the width
 * at which the form stops being a single stack and picks up the same
 * two-column layout it has in full screen. Capped against the viewport so a
 * panel never becomes the whole window on a laptop — at that point you want
 * full screen, and there is a button for it.
 *
 * @internal See {@link CONTAINER_FULL_WIDTH}.
 */
export const SIDE_PANEL_DEFAULT_WIDTH = "min(1160px, 88vw)";
