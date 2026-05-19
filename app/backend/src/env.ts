import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { loadEnv } from "@rebasepro/server-core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export const env = loadEnv();
