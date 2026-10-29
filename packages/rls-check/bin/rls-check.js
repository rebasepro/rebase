#!/usr/bin/env node
/**
 * `npx @rebasepro/rls-check <connection-string>`
 *
 * Deliberately thin: no staleness check, no dependency loading, nothing that
 * could add latency or a failure mode to a first-run `npx` on a stranger's
 * machine. All behaviour, including argument parsing and exit codes, is in
 * `src/cli.ts`.
 */
const { runCli } = await import("../dist/index.es.js");

process.exitCode = await runCli(process.argv.slice(2));
