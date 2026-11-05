// The view's built HTML, imported as text. Declared here rather than left to
// vite/client so every program that reaches this package through a path
// mapping (tsconfig.core.json, the BaaS typecheck) can resolve it without
// the view having been built or Vite's types loaded.
declare module "*.html?raw" {
    const html: string;
    export default html;
}
