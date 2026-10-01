/**
 * Build a Jest environment that runs its test file with the host zone pinned.
 *
 * A test cannot do this itself. Jest gives every test file a copy of
 * `process.env`, so `process.env.TZ = "…"` inside the file never reaches the
 * real process and Node keeps the zone it started with. An environment runs in
 * the worker itself, where assigning `TZ` is what makes Node re-read the zone,
 * and it puts the worker's own zone back in teardown so the next file the
 * worker runs is unaffected.
 *
 * Why a file would want this: a regression test about zones that runs "in
 * whatever zone the machine is in" proves nothing on a machine in UTC — which is
 * every CI runner. The date-only tests in packages/cms passed on CI with their
 * fix reverted, and failed only on a developer's laptop.
 *
 * Each pinned zone gets a small file of its own, named after the zone, which a
 * test opts into with a docblock (the path is relative to the package root):
 *
 *     /** @jest-environment ./test/helpers/los-angeles-tz-environment.cjs *\/
 *
 * and the test file should assert the zone it got, so a runtime that ignored the
 * assignment fails loudly instead of passing against UTC.
 *
 * @param {new (...args: any[]) => { setup(): Promise<void>, teardown(): Promise<void> }} Base
 *        the environment to extend — `jest-environment-node`'s or `-jsdom`'s
 *        `TestEnvironment`, resolved from the package that uses it.
 * @param {string} zone an IANA zone name.
 */
function pinZone(Base, zone) {
    return class PinnedZoneEnvironment extends Base {
        async setup() {
            this.originalTz = process.env.TZ;
            process.env.TZ = zone;
            await super.setup();
        }

        async teardown() {
            if (this.originalTz === undefined) delete process.env.TZ;
            else process.env.TZ = this.originalTz;
            await super.teardown();
        }
    };
}

module.exports = { pinZone };
