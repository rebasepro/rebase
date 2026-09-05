/**
 * The CLI's public entry — deliberately small.
 *
 * This file used to `export *` from sixteen modules: every command function,
 * `detectPackageManager`, `findProjectRoot`, the whole of `commands/cloud`. None
 * of it was imported by anything, in this repository or the control plane, and
 * none of it was meant to be: `@rebasepro/cli` is a program, and a program's
 * internals become an API the moment they are exported and published. The
 * barrel was written the way barrels get written — one line per file — and the
 * surface it created was an accident of that convention rather than a decision.
 *
 * Three things are exported, each for a stated reason.
 */

/**
 * What `bin/rebase.js` calls. The binary imports `dist/index.es.js` and invokes
 * `entry()`, so this is the one export the CLI cannot run without.
 */
export { entry } from "./cli";

/**
 * The manifest and bundle contracts.
 *
 * Exported because validating them is not only the CLI's job: a control plane
 * has to decide whether a submitted bundle can run before it deploys it, and it
 * must reach that verdict with the same code that produced the artifact.
 */
export * from "./manifest";
export * from "./bundle";
