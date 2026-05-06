import { createRebaseClient } from "@rebasepro/client";

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:3001" : undefined);

export const client = createRebaseClient({
  baseUrl: API_URL
});
