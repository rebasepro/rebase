import React, { useContext } from "react";
import { render } from "@testing-library/react";
import type { DataDriver, RebaseData } from "@rebasepro/types";
import { CollectionResolverRegistrationContext, Rebase, useData } from "@rebasepro/app";

/**
 * Several layers can hand `<Rebase>` their collections at once.
 *
 * The data layer gives a row its address from its collection's primary key, and
 * learns the collections from whichever layer below `<Rebase>` owns them. There
 * was one slot for that: two standalone collection views on one page — each
 * owning its own collection — overwrote each other, and the rows of whichever
 * registered first came back with no id, so they could not be opened or saved.
 * Each layer now registers under its own owner key, and a lookup asks them all.
 */

const rows: Record<string, Record<string, unknown>[]> = {
    posts: [{ slug: "hello", title: "Hello" }],
    authors: [{ handle: "ada", name: "Ada" }]
};

const driver: DataDriver = {
    key: "memory",
    fetchCollection: async ({ path }) => rows[path] ?? [],
    fetchOne: async () => undefined,
    save: async ({ values }) => ({ ...values }),
    delete: async () => undefined
};

const authController = {
    user: { uid: "u1" },
    initialLoading: false,
    authLoading: false,
    loginSkipped: true,
    getAuthToken: async () => "t"
} as never;

function Owner({ owner, slug, idProperty }: { owner: string, slug: string, idProperty: string }) {
    const register = useContext(CollectionResolverRegistrationContext);
    register((candidate) => candidate === slug
        ? { properties: { [idProperty]: { type: "string", isId: true } } }
        : undefined, undefined, owner);
    return null;
}

describe("collection resolvers registered by several owners", () => {
    it("give the rows of every owner's collection their address", async () => {
        const captured: { data?: RebaseData } = {};
        function Probe() {
            captured.data = useData();
            return null;
        }
        render(
            <Rebase authController={authController} storageSource={{} as never}
                dataSources={[{ key: "(default)", engine: "postgres", driver }]}>
                <Owner owner={"first"} slug={"posts"} idProperty={"slug"}/>
                <Owner owner={"second"} slug={"authors"} idProperty={"handle"}/>
                <Probe/>
            </Rebase>
        );

        const posts = await captured.data!.collection("posts").find();
        const authors = await captured.data!.collection("authors").find();

        expect(posts.data.map(entity => entity.id)).toEqual(["hello"]);
        expect(authors.data.map(entity => entity.id)).toEqual(["ada"]);
    });

    it("forget an owner that registers nothing", async () => {
        const captured: { data?: RebaseData } = {};
        function Probe() {
            captured.data = useData();
            const register = useContext(CollectionResolverRegistrationContext);
            register(undefined, undefined, "first");
            return null;
        }
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            render(
                <Rebase authController={authController} storageSource={{} as never}
                    dataSources={[{ key: "(default)", engine: "postgres", driver }]}>
                    <Owner owner={"first"} slug={"posts"} idProperty={"slug"}/>
                    <Probe/>
                </Rebase>
            );
            const posts = await captured.data!.collection("posts").find();
            expect(posts.data.map(entity => entity.id)).not.toEqual(["hello"]);
        } finally {
            warn.mockRestore();
        }
    });
});
