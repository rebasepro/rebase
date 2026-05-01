import { createTransport, buildQueryString } from "./packages/client/src/transport";
import { createCollectionClient } from "./packages/client/src/collection";

const transport = createTransport({
    baseUrl: "http://localhost:3000",
    apiPath: "/api"
});

const jobsCollection = createCollectionClient(transport, "jobs");

async function main() {
    let q = jobsCollection
            .where("status", "==", "published")
            .orderBy("featured", "desc")
            .orderBy("created_at", "desc")
            .limit(10)
            .offset(0);

    console.log(buildQueryString(q["params"]));
}

main().catch(console.error);
