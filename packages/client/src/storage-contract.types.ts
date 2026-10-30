/**
 * Compile-time assertions about `client.storage.putObject`.
 *
 * A plain module under `src`, imported by nothing, for the reason
 * `query-contract.types.ts` gives: `pnpm typecheck` reads `src`, and a type
 * assertion in a jest test is checked by nothing.
 *
 * The SDK's upload takes any `Blob` and an optional key — with none, the server
 * names the object after the file — and the SDK docs say so. Its parameter was
 * the server controllers' `UploadFileProps`, whose `key` is required and whose
 * `file` is a `File`, so both documented calls were compile errors.
 */
import type { CreateRebaseClientResult, StorageSource } from "./index";

declare const client: CreateRebaseClientResult;
declare const blob: Blob;

export const keyless = (): unknown => client.storage.putObject({ file: blob });
export const named = (): unknown => client.storage.putObject({ file: blob, key: "products/camera.jpg", public: true });

// Still a StorageSource: everything that takes one — the registry, the panel's
// upload controller — takes the SDK's.
export const asSource: StorageSource = client.storage;
