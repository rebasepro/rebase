import jwt from "jsonwebtoken";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function test() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error("JWT_SECRET not found in env");
    }

    const payload = {
        userId: "f06be7ca-a726-4a72-be77-c705227ed3c0",
        roles: ["admin"]
    };

    const token = jwt.sign(payload, secret, { expiresIn: "1h" });
    console.log("Token generated:", token);

    console.log("Fetching roles from API...");
    const res = await fetch("http://localhost:3070/api/admin/roles", {
        headers: {
            "Authorization": `Bearer ${token}`
        }
    });

    console.log("Response status:", res.status);
    const body = await res.json();
    console.log("Response body:", JSON.stringify(body, null, 2));
}

test().catch(console.error).finally(() => process.exit(0));
