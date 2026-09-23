/**
 * A Jest environment that runs its test file with the host zone set to
 * Europe/Madrid.
 *
 * A test cannot do this itself. Jest gives every test file a copy of
 * `process.env`, so `process.env.TZ = "…"` inside the file never reaches the
 * real process and Node keeps the zone it started with. `cron-dst.test.ts` did
 * exactly that: it passed on a developer machine that was already on Madrid
 * time and failed in CI, which runs in UTC. This module runs in the worker
 * itself, where assigning `TZ` is what makes Node re-read the zone, and it puts
 * the worker's own zone back in teardown so the next file the worker runs is
 * unaffected.
 *
 * Opt a file in with a docblock at its top:
 *
 *     /** @jest-environment ./test/helpers/madrid-tz-environment.cjs *\/
 */
const { TestEnvironment } = require("jest-environment-node");

const ZONE = "Europe/Madrid";

class MadridTimezoneEnvironment extends TestEnvironment {
    async setup() {
        this.originalTz = process.env.TZ;
        process.env.TZ = ZONE;
        await super.setup();
    }

    async teardown() {
        if (this.originalTz === undefined) delete process.env.TZ;
        else process.env.TZ = this.originalTz;
        await super.teardown();
    }
}

module.exports = MadridTimezoneEnvironment;
