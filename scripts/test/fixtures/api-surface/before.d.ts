/* eslint-disable @typescript-eslint/no-empty-object-type -- an interface with an
   empty body, inheriting everything, IS the fixture: that is the shape the
   renderer used to record as a bare name. */
/**
 * The "last release" side of the gate's own fixture. `after.d.ts` is the same
 * barrel with three members taken away; `after-singleton-only.d.ts` takes away
 * just one.
 *
 * Shaped like the real barrel in the way that matters: every type these exports
 * are declared against comes from `./types` and is not re-exported, so nothing
 * else in the rendered surface covers their members.
 */
import type { ServerClientV1, BaseRepoV1 } from "./types";

/** The singleton every tenant hook, function and cron imports. */
export declare const rebase: ServerClientV1;

/** Renders as a bare name legitimately — a function has no members. */
export declare function fixtureHelper(): void;

/** Empty body, everything inherited — the `AuthRepository` shape. */
export interface FixtureRepository extends BaseRepoV1 {
}

/** Extends an ambient global, whose members are the platform's, not ours. */
export declare class FixtureError extends Error {
    hint?: string;
    static notFound(): FixtureError;
}
