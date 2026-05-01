import { createRebaseClient } from "../packages/client/src/index";

async function main() {
  const client = createRebaseClient({
    baseUrl: "http://localhost:3070",
    apiKey: process.env.REBASE_SERVICE_KEY || "test-api-key"
  });

  const posts = await client.collection("posts").find({ limit: 1 });
  console.log(JSON.stringify(posts, null, 2));
}

main().catch(console.error);
