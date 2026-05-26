import { Hono } from "hono";

async function main() {
    const app = new Hono();
    app.post("/api/admin/roles", (c) => c.text("success"));

    // Test with relative path
    const res1 = await app.request("/api/admin/roles", { method: "POST" });
    console.log("Relative path status:", res1.status); // Expected: 200

    // Test with absolute URL (localhost)
    const res2 = await app.request("http://localhost/api/admin/roles", { method: "POST" });
    console.log("Absolute URL status:", res2.status); // Is it 200 or 404?
}

main().catch(console.error);
