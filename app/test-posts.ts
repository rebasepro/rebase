import { rebase } from "@rebasepro/client";

async function main() {
  const client = rebase({
    url: "http://localhost:3070",
    apiKey: "test-api-key"
  });

  try {
    const posts = await client.collection("posts").find({ limit: 1 });
    console.log(JSON.stringify(posts, null, 2));
  } catch (err) {
    console.error("Error fetching posts:", err);
  }
}

main().catch(console.error);
