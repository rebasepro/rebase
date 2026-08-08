/* eslint-disable @typescript-eslint/no-empty-object-type -- see before.d.ts. */
/**
 * `before.d.ts` with `rebase.email` removed and nothing else touched.
 *
 * The narrowest version of the failure this gate exists for, and the one it used
 * to miss completely: no exported declaration here differs from `before.d.ts` by
 * a byte, so a renderer that reads declaration syntax produces an identical
 * surface and the gate exits 0 on a change that throws in every tenant's hook.
 */
import type { ServerClientV2, BaseRepoV1 } from "./types";

export declare const rebase: ServerClientV2;

export declare function fixtureHelper(): void;

export interface FixtureRepository extends BaseRepoV1 {
}

export declare class FixtureError extends Error {
    hint?: string;
    static notFound(): FixtureError;
}
