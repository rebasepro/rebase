/**
 * The fixture's `@rebasepro/types`: the shapes the barrel's exports are declared
 * *against*, in a module the barrel does not re-export.
 *
 * They have to live here rather than in the barrel itself, because a `.d.ts`
 * lists even its non-exported declarations in `getExportsOfModule` — so a local
 * interface would still show up in the rendered surface and cover the singleton
 * by accident. That is not the real situation: `RebaseServerClient` is declared
 * in another package and `@rebasepro/server` does not re-export it, which is
 * exactly why nothing but `const rebase` itself covered its members.
 */

/** The singleton's type before the release. */
export interface ServerClientV1 {
    auth: unknown;
    dataAsAdmin: unknown;
    email: { send(): void };
}

/** …and after, with `email` gone. */
export interface ServerClientV2 {
    auth: unknown;
    dataAsAdmin: unknown;
}

/** A base an exported interface inherits everything from. */
export interface BaseRepoV1 {
    createUser(): void;
    deleteUser(): void;
}

/** …and after, with `deleteUser` gone. */
export interface BaseRepoV2 {
    createUser(): void;
}
