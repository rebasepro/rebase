/**
 * Ambient declarations for the asset imports a frontend component makes.
 *
 * A collection that references a component with a lazy `import()` thunk gets that
 * reference type-checked — which means TypeScript resolves the component's *own*
 * imports too, including Vite's asset handling. Vite is not a dependency of this
 * package (and should not be: nothing here runs in a browser), so its `vite/client`
 * types are not available and these three lines stand in for them.
 */
declare module "*.png" { const src: string; export default src; }
declare module "*.svg" { const src: string; export default src; }
declare module "*.jpg" { const src: string; export default src; }
