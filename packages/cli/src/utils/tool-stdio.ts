/**
 * The stdio a build tool the CLI runs in the foreground gets: a static app's
 * build command, `tsc`, `tar`.
 *
 * Inherited, so its output streams as it happens. With `quietStdout` its stdout
 * goes to stderr instead, for a command whose own stdout carries a result:
 * `rebase cloud deploy` in JSON mode — every piped run — owes stdout exactly one
 * JSON value, and a `vite v6 building…` line in front of it is a result no
 * parser can read. The tool's output still reaches the person watching.
 */
export function toolStdio(quietStdout: boolean | undefined): "inherit" | ["ignore", 2, "inherit"] {
    return quietStdout ? ["ignore", 2, "inherit"] : "inherit";
}
