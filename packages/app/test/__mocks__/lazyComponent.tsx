/**
 * A stand-in for a custom Field/Preview living in a project's `frontend/`.
 *
 * `resolveComponentRef` never calls the loader — `React.lazy` defers that until
 * render — so these tests pass without this module existing. It exists anyway, so
 * the fixtures point at something real and a future test can render one.
 */
export default function LazyComponent() {
    return null;
}
