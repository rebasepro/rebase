/* eslint-disable @typescript-eslint/no-empty-object-type -- see before.d.ts. */
/**
 * The "this release" side of the gate's own fixture: `before.d.ts` with
 * `rebase.email` gone, `FixtureRepository.deleteUser` gone (through the base it
 * inherits from), and the static `FixtureError.notFound` gone.
 *
 * Every one of those is a boot failure for a bundle that is already built, and
 * the first two read as "✓ API surface unchanged" until the renderer stopped
 * reading syntax and started resolving types.
 */
import type { ServerClientV2, BaseRepoV2 } from "./types";

export declare const rebase: ServerClientV2;

export declare function fixtureHelper(): void;

export interface FixtureRepository extends BaseRepoV2 {
}

export declare class FixtureError extends Error {
    hint?: string;
}
