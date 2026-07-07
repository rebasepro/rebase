// Committed cron fixture (CJS — see sibling package.json).
// Loaded by define-cron.test.ts via loadCronJobsFromDirectory. A committed
// file avoids the mkdtemp→write→native-import→rmSync lifecycle race that made
// the previous temp-file version flaky under jest's parallel workers.
module.exports = {
    name: "Fixture job",
    schedule: "*/10 * * * *",
    description: "Test fixture",
    handler: async function (ctx) {
        ctx.log("hello");
        return { ok: true };
    },
};
