/**
 * The default of the `"Entity.MissingReference"` override: nothing. A
 * reference or relation whose collection is not registered shows an error
 * unless an app overrides this, which is how a caller tells the two apart.
 */
export function DefaultMissingReference(_props: { path: string }): null {
    return null;
}
