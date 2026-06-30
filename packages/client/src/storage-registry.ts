/**
 * Client-side storage source registry.
 *
 * Manages multiple `StorageSource` instances keyed by
 * `StorageSourceDefinition.key`. Collection properties reference
 * a source by key via `StorageConfig.storageSource`.
 *
 * Typical bootstrap flow:
 * 1. Fetch definitions from `GET /api/storage/sources`
 * 2. Build server-backed sources automatically via `createStorage(transport, key)`
 * 3. Register "direct" sources manually (e.g. Firebase Storage hook)
 */

import type { StorageSource, StorageSourceRegistry, StorageSourceDefinition } from "@rebasepro/types";
import { DEFAULT_STORAGE_SOURCE_KEY } from "@rebasepro/types";
import { createStorage } from "./storage";
import type { Transport } from "./transport";

/**
 * Default implementation of the client-side `StorageSourceRegistry`.
 */
export class ClientStorageSourceRegistry implements StorageSourceRegistry {
    private sources = new Map<string, StorageSource>();

    /**
     * Register a storage source.
     * @param key - Unique key matching a `StorageSourceDefinition.key`
     * @param source - The `StorageSource` instance
     */
    register(key: string, source: StorageSource): void {
        this.sources.set(key, source);
    }

    getDefault(): StorageSource {
        const source = this.sources.get(DEFAULT_STORAGE_SOURCE_KEY);
        if (!source) {
            throw new Error(
                `[StorageSourceRegistry] No default storage source registered. ` +
                `Register one with key "${DEFAULT_STORAGE_SOURCE_KEY}".`
            );
        }
        return source;
    }

    get(key: string | undefined | null): StorageSource | undefined {
        if (key === undefined || key === null) {
            return this.sources.get(DEFAULT_STORAGE_SOURCE_KEY);
        }
        return this.sources.get(key);
    }

    getOrDefault(key: string | undefined | null): StorageSource {
        if (key === undefined || key === null) {
            return this.getDefault();
        }
        const source = this.sources.get(key);
        if (source) return source;

        // Fallback to default
        console.warn(
            `[StorageSourceRegistry] Storage source "${key}" not found, ` +
            `falling back to "${DEFAULT_STORAGE_SOURCE_KEY}".`
        );
        return this.getDefault();
    }

    has(key: string): boolean {
        return this.sources.has(key);
    }

    list(): string[] {
        return Array.from(this.sources.keys());
    }

    /**
     * Build a registry from `StorageSourceDefinition[]` and an HTTP transport.
     *
     * - Sources with `transport: "server"` are auto-wired via `createStorage(transport, key)`.
     * - Sources with `transport: "direct"` are **not** auto-wired — they must
     *   be registered manually after this call (e.g. via a Firebase hook).
     *
     * @param definitions - Array of storage source definitions
     * @param transport - HTTP transport for server-backed sources
     */
    static fromDefinitions(
        definitions: StorageSourceDefinition[],
        transport: Transport
    ): ClientStorageSourceRegistry {
        const registry = new ClientStorageSourceRegistry();

        for (const def of definitions) {
            if (def.transport === "server") {
                // Auto-create a server-backed StorageSource for this key
                const source = createStorage(transport, def.key === DEFAULT_STORAGE_SOURCE_KEY ? undefined : def.key);
                registry.register(def.key, source);
            }
            // "direct" sources must be registered manually
        }

        return registry;
    }
}
