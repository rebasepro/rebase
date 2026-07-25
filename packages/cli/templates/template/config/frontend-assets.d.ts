/**
 * Ambient declarations for the asset imports a frontend component makes.
 *
 * A collection that points at a custom `Field` or `Preview` with a lazy `import()`
 * thunk gets that reference type-checked — which means TypeScript resolves the
 * component's *own* imports too, including `import icon from "./icon.png"`. That
 * import is Vite's doing and means nothing to `tsc`: the frontend gets away with it
 * through `vite/client` types, but those belong to the frontend's program, not this
 * one, and Vite is not a dependency here (nothing in `config/` runs in a browser).
 *
 * Without these three lines, adding your first custom component fails the config and
 * backend builds with `Cannot find module './icon.png'` — pointing at a frontend file
 * from a build that has no obvious business compiling it.
 */
declare module "*.png" { const src: string; export default src; }
declare module "*.svg" { const src: string; export default src; }
declare module "*.jpg" { const src: string; export default src; }
