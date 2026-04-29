import { createRebaseClient } from "@rebasepro/client";

async function main() {
    console.log("Initializing Rebase SDK client...");
    // Assume backend is on port 3001 or 3070, we'll try 3070
    const client = createRebaseClient({ 
        baseUrl: "http://localhost:3070",
        // In a real app we'd pass auth, but test-email is public
    });

    console.log("Calling custom function 'test-email' via SDK...");
    try {
        const result = await client.call("functions/test-email", {});
        console.log("✅ Success! Response from function:");
        console.log(JSON.stringify(result, null, 2));
    } catch (err: any) {
        console.error("❌ Failed to call function:");
        console.error(err.message);
        
        // Try 3001 as fallback
        console.log("\nTrying port 3001 instead...");
        const client2 = createRebaseClient({ baseUrl: "http://localhost:3001" });
        try {
            const result2 = await client2.call("functions/test-email", {});
            console.log("✅ Success on 3001! Response:");
            console.log(JSON.stringify(result2, null, 2));
        } catch (e2: any) {
            console.error("❌ Failed on 3001 as well:");
            console.error(e2.message);
        }
    }
}

main().catch(console.error);
