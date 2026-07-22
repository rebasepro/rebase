import { createRebaseClient } from "@rebasepro/client";

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:3001" : undefined);

/**
 * Demo-only network switch.
 *
 * The offline engine keys on the failure `fetch` produces when the network is
 * gone, so simulating one here is the honest way to show it off — no asking
 * anyone to open devtools and tick "Offline".
 */
let networkDown = false;
const listeners = new Set<(down: boolean) => void>();

export function isNetworkDown() {
  return networkDown;
}

export function onNetworkChange(listener: (down: boolean) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const demoFetch: typeof fetch = (input, init) => {
  if (networkDown) return Promise.reject(new TypeError("Failed to fetch"));
  return fetch(input, init);
};

export const client = createRebaseClient({
  baseUrl: API_URL,
  fetch: demoFetch,
  // Local-first: reads fall back to the local row database, and writes made
  // while offline apply immediately and replay when the connection returns.
  offline: true
});

export function setNetworkDown(down: boolean) {
  networkDown = down;
  for (const listener of listeners) listener(down);
  // Coming back is the interesting half — the queue drains on its own.
  if (!down) void client.offline?.sync();
}
