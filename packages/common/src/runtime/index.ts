/**
 * Model-agnostic helpers the data runtime reads — the Postgres driver and the
 * server — with no view model in them: what a relation reference looks like,
 * whether an address can name a row, a column's own name, the client a hook
 * reads, and the tenancy rule a write obeys.
 *
 * @module
 */
export * from "./addressable-id";
export * from "./column-name";
export * from "./callback-client";
export * from "./tenant-write";
