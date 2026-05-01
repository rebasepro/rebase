import { createTransport } from "./packages/client/src/transport";
import { createCollectionClient } from "./packages/client/src/collection";

const transport = createTransport({
    baseUrl: "http://localhost:3001",
    apiPath: "/api"
});

const jobsCollection = createCollectionClient(transport, "jobs");

async function main() {
    try {
        const res = await jobsCollection
            .where("status", "==", "published")
            .orderBy("featured", "desc")
            .limit(10)
            .offset(0)
            .find();
        console.log("Jobs found:", res.data.length);
        console.log("Total meta:", res.meta);
        console.log(res.data);
    } catch (e) {
        console.error("Error:", e);
    }
}

main();
