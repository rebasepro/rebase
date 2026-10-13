import { openRebase, type OpenedRebase } from "../src/index";

/**
 * `openRebase` is typed by a project's `Database`, as a function's
 * `rebase.dataAsAdmin` is.
 *
 * Its result was pinned to `RebaseServerClient<unknown>`, so `dataAsAdmin`
 * took any collection by any name and any field with any value — before and
 * after `rebase generate-sdk --register` — while the same line in a function
 * was checked. It defaults to `RegisteredDatabase` now, and takes a
 * `Database` of its own as a type argument.
 *
 * There is no runtime here on purpose: the file is named `.type-test.ts` so
 * jest does not collect it, and `tsconfig.tests.json` names it so tsc reads
 * it. The registered default is proved against a program of its own in
 * `open-rebase-register-types.test.ts`, because registering here would
 * register for every file in the tests program.
 */

/** A generated `Database`, in the shape codegen emits. */
type Database = {
    posts: {
        Row: { id: string; title: string; status: "draft" | "published" };
        Insert: { title: string; status?: "draft" | "published" };
        Update: { title?: string; status?: "draft" | "published" };
    };
};

export async function typedByItsTypeArgument(): Promise<void> {
    const rebase = await openRebase<Database>({ databaseUrl: "postgres://localhost/app", collections: [] });

    const { data } = await rebase.dataAsAdmin.posts.find({ limit: 3 });
    const titles: string[] = data.map(post => post.title);
    await rebase.dataAsAdmin.posts.update("1", { status: "published" });

    // @ts-expect-error — the `Database` declares no such collection
    await rebase.dataAsAdmin.nonsenseCollection.find({});
    // @ts-expect-error — not one of the column's values
    await rebase.dataAsAdmin.posts.update("1", { status: "not-an-enum-value" });
    // @ts-expect-error — not a field of the row
    await rebase.dataAsAdmin.posts.update("1", { bogus: 1 });

    const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
    const hers: string[] = (await ada.data.posts.find()).data.map(post => post.status);
    // @ts-expect-error — the user's view is typed by the same `Database`
    await ada.data.nonsenseCollection.find({});

    void titles;
    void hers;
}

/** The interface carries the same type, for a helper that takes an opened project. */
export async function countPosts(rebase: OpenedRebase<Database>): Promise<number> {
    // @ts-expect-error — a row has no such field
    const ids: number[] = (await rebase.dataAsAdmin.posts.find()).data.map(post => post.views);
    return ids.length;
}

/**
 * With no `Database` registered and none named, every collection name is
 * accepted and rows are open records — unchanged for a project that never
 * generated types.
 */
export async function untypedWithoutARegistration(): Promise<void> {
    const rebase = await openRebase({ databaseUrl: "postgres://localhost/app", collections: [] });
    const { data } = await rebase.dataAsAdmin.anyCollection.find();
    const value: unknown = data[0]?.anyField;
    void value;
}
