import { defineCron } from "@rebasepro/server-core";

export default defineCron({
    name: "Refresh product stats",
    schedule: "*/30 * * * *",
    description: "Counts active products and logs the total — demo/dogfood job.",

    async handler({ client, log }) {
        const { meta } = await client.data.collection("products").find({ limit: 1 });
        log(`products total: ${meta.total}`);
        return { total: meta.total };
    },
});
