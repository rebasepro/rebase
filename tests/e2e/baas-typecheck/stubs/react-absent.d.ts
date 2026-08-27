/**
 * Stands in for `react` in a project that has not installed it.
 *
 * `tsconfig.json` maps "react", "react-dom" and "react/jsx-runtime" here. The
 * shape is deliberately a single nonsense member rather than `any`: `any` would
 * silently absorb every `React.ReactNode` in the graph and the fixture would
 * pass while proving nothing.
 *
 * A named import (`import { ReactNode } from "react"`) fails with "no exported
 * member". A default or namespace import survives, but the first member access
 * fails and names the file — which is the diagnostic worth having.
 *
 * Not `export {}` alone: with esModuleInterop on (needed for `import pg from
 * "pg"` and friends throughout the core packages) a default import from an
 * export-less module is legal, so the error would only surface at use.
 */
declare const reactIsNotInstalled: {
    __rebase_react_is_not_installed__: "Install react, or move this type to @rebasepro/cms-types";
};

export default reactIsNotInstalled;
