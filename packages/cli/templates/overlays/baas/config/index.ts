/**
 * The config package for a headless project.
 *
 * There are no collections here: this flavour introspects them from the live
 * database at boot, which is exactly what "no `config/collections` directory"
 * means to `rebase build`.
 *
 * The package still exists because storage does not run under row-level
 * security and its keys share one flat namespace — so without an access model,
 * a deployment with file storage enabled serves every user's files to every
 * signed-in user. The server refuses to boot in that state, and this is the
 * export it looks for.
 *
 * It depends on `@rebasepro/common` for one thing: `defineCollection`, which
 * `rebase schema introspect` writes its output against. A plain
 * `const x: PostgresCollectionConfig = { … }` annotation widens the property
 * keys to `string`, so nothing checks the keys named elsewhere in the config —
 * and the keys an introspected collection has are precisely the ones nobody
 * typed and nobody remembers. `common` is the headless half of the pair: same
 * key inference as `@rebasepro/admin-types`, no admin surface, no React.
 */

export { storageAuthorize } from "./storage.js";
