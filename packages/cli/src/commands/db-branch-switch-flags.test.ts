/**
 * `rebase db branch switch` refuses a flag it does not take.
 *
 * `switch` is answered by the CLI, before the driver and its strict branch
 * flags are reached, so it read `--off` with `rawArgs.includes` and let
 * anything else through: `rebase db branch switch --of` reported the current
 * branch, exit 0, instead of leaving it.
 */
import { describe, expect, it } from "vitest";

import { assertSwitchFlags } from "./db";

const line = (...words: string[]) => ["/usr/bin/node", "/usr/local/bin/rebase", "db", "branch", "switch", ...words];

describe("assertSwitchFlags", () => {
    it("names the flag a typo was one edit from", () => {
        expect(() => assertSwitchFlags(line("--of")))
            .toThrow("`rebase db branch switch` has no option --of — did you mean --off? Nothing was run. See `rebase db branch --help`.");
    });

    it("says what it takes when nothing is close", () => {
        expect(() => assertSwitchFlags(line("feature", "--bogus"))).toThrow(/no option --bogus — it takes --off/);
    });

    it("accepts its own flags, the relayed ones, a name, and --debug before the command", () => {
        expect(() => assertSwitchFlags(line("--off"))).not.toThrow();
        expect(() => assertSwitchFlags(line("--main"))).not.toThrow();
        expect(() => assertSwitchFlags(line("feature", "--docker"))).not.toThrow();
        expect(() => assertSwitchFlags(line("feature", "--database-url", "postgres://u@h/app"))).not.toThrow();
        expect(() => assertSwitchFlags(line("feature", "--database-url=postgres://u@h/app"))).not.toThrow();
        expect(() => assertSwitchFlags(["/usr/bin/node", "/usr/local/bin/rebase", "--debug", "db", "branch", "switch", "x"])).not.toThrow();
    });

    // `--off=false` is not "stay on": a value on a switch is refused.
    it("refuses a value on one of its switches", () => {
        expect(() => assertSwitchFlags(line("--off=false")))
            .toThrow("`rebase db branch switch` takes --off without a value (--off=false): give it to turn it on, and leave it out to turn it off.");
        expect(() => assertSwitchFlags(line("feature", "--docker=true"))).toThrow(/takes --docker without a value/);
    });

    it("is a usage error, which the CLI prints as one line", () => {
        try {
            assertSwitchFlags(line("--of"));
        } catch (error) {
            expect(error).toMatchObject({ isUsageError: true });
            return;
        }
        throw new Error("accepted --of");
    });
});
