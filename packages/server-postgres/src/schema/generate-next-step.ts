/**
 * The line `rebase schema generate` ends on.
 *
 * Its own module because `generate-drizzle-schema.ts` uses `import.meta` to
 * decide whether it was executed directly, which the driver's jest suite cannot
 * load at all — so the one sentence in that file with a decision in it had no
 * test and could not have one where it stood.
 *
 * Printed only by `rebase schema generate` itself. `db push` and `db generate`
 * run the same generator as their first step, and inside them the line was
 * wrong advice: `db push` was told to run `db generate`, and `db generate` to
 * run itself.
 */
import chalk from "chalk";

/**
 * A command name, highlighted the way the rest of the driver's output is: with
 * chalk, which drops the colour under `NO_COLOR`, when stdout is not a terminal,
 * and in CI logs. The escapes used to be written by hand here, so
 * `NO_COLOR=1 rebase schema generate > log` put `\x1b[1m\x1b[44m…` in the file.
 */
const command = (text: string): string => chalk.bold.bgBlue.black(text);

/**
 * What to do with the file that was just generated.
 *
 * Not the same answer on the managed development database: `rebase db generate`
 * plans with Atlas, Atlas needs a second empty database to diff against, and
 * PGlite serves exactly one — so the CLI refuses that command outright there.
 * This line recommended it unconditionally, which meant every stock scaffold
 * was told, by the tool itself, to run something the same tool would refuse.
 *
 * The kind arrives as `REBASE_DEV_DATABASE_KIND`, set by the CLI from the
 * ordered resolution in `dev-db/resolve.ts`. It is a pure decision — nothing is
 * started to make it — and the driver cannot make it for itself: on the managed
 * path `DATABASE_URL` is a perfectly ordinary connection string to a Postgres
 * on loopback. Absent (the driver run directly, outside the CLI) keeps the
 * original wording.
 */
export const nextStepAfterGenerate = (): string => {
    if (process.env.REBASE_DEV_DATABASE_KIND === "managed") {
        return `Start or restart ${command("rebase dev")} — boot applies your collections to the managed development database.`;
    }

    return `You can now run ${command("rebase db generate")} to generate the SQL migration files.`;
};
