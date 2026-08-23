import { defineCron } from "@rebasepro/server";

export default defineCron({
    name: "Refresh product stats",
    schedule: "*/30 * * * *",
    description: "Counts active products and logs the total — demo/dogfood job.",

    async handler({ rebase, log }) {
        const { meta } = await rebase.dataAsAdmin.collection("products").find({ limit: 1 });
        log(`products total: ${meta.total}`);
        return { total: meta.total };
    },
});
