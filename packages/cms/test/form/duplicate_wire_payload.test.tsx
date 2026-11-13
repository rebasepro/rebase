/**
 * @jest-environment jsdom
 *
 * What the admin's Duplicate sends to the server, read where it arrives.
 *
 * The chain is the admin's own, end to end: the record is read through the
 * admin boundary (`wrapAsEntityData` with the panel's view model,
 * `collectionEntityDataOptions`) from a row served with its relations
 * included; the Copy action turns the table row back into the record
 * (`rowOfEntity` → `entityOfRow`); the copy form opens with
 * `getInitialEntityValues(…, "copy", …)` as `EntityFormBinding` computes it;
 * the record form submits; and the save runs through
 * `saveEntityWithCallbacks` and the same data layer, down to a driver that
 * records what it is handed — what a server receives once the body is JSON.
 *
 * The backend accepts wire values only (a to-one relation as its key, a vector
 * as numbers); a relation object is a 400. A row holding a `belongsTo`, a
 * `hasOne`, a `hasMany`, a many-to-many whose links carry a `_pivot`, a date,
 * a vector and a storage field is the case where a duplicate could send an
 * included object back.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render } from "@testing-library/react";
import type { DataDriver, SaveProps } from "@rebasepro/types";
import { buildSdkData } from "@rebasepro/common";
import { collectionEntityDataOptions, wrapAsEntityData, type AdminCollection, type CollectionConfig, type EntityCustomViewParams, type FormContext } from "@rebasepro/cms-types";

class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
Object.assign(global, { ResizeObserver: ResizeObserverStub });

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useRebaseContext: () => ({}),
        useCustomizationController: () => ({ plugins: [], propertyConfigs: {}, entityActions: [], entityViews: [], resolvedSlots: [] }),
        useAuthController: () => ({ user: { uid: "u1" } }),
        useSnackbarController: () => ({ open: () => undefined })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { entityOfRow, rowOfEntity, saveEntityWithCallbacks } from "@rebasepro/app";
import { EntityForm } from "../../src/form/EntityForm";
import { getInitialEntityValues } from "../../src/form/form_utils";
import { saving } from "../helpers/form_rows";
import { fakeAuthController, fakeRebaseContext, fakeUser } from "../helpers/fakes";

type Author = Record<string, unknown>;

const editors: CollectionConfig = { slug: "editors", name: "Editors", properties: { id: { type: "string", isId: true }, name: { type: "string" } } };
const profiles: CollectionConfig = { slug: "profiles", name: "Profiles", properties: { id: { type: "string", isId: true }, bio: { type: "string" } } };
const posts: CollectionConfig = { slug: "posts", name: "Posts", properties: { id: { type: "string", isId: true }, title: { type: "string" } } };
const tags: CollectionConfig = { slug: "tags", name: "Tags", properties: { id: { type: "string", isId: true }, label: { type: "string" } } };

const authors: AdminCollection = {
    slug: "authors",
    name: "Authors",
    properties: {
        id: { type: "string", isId: true },
        name: { type: "string" },
        bornAt: { type: "date" },
        embedding: { type: "vector", dimensions: 3 },
        avatar: { type: "string", storage: { storagePath: "avatars" } },
        editor: { type: "relation", relation: { kind: "belongsTo", target: () => editors, localKey: "editor_id" } },
        profile: { type: "relation", relation: { kind: "hasOne", target: () => profiles, foreignKeyOnTarget: "author_id" } },
        posts: { type: "relation", relation: { kind: "hasMany", target: () => posts, foreignKeyOnTarget: "author_id" } },
        tags: {
            type: "relation",
            relation: {
                kind: "manyToMany",
                target: () => tags,
                through: {
                    table: "authors_tags", sourceColumn: "author_id", targetColumn: "tag_id",
                    properties: { weight: { type: "number" } }
                }
            }
        }
    }
};

const collections = new Map<string, CollectionConfig>([
    ["authors", authors], ["editors", editors], ["profiles", profiles], ["posts", posts], ["tags", tags]
]);

/** The original, as the server serves it read with every relation included. */
const SERVED = {
    id: "a-1",
    name: "Ada",
    bornAt: "1815-12-10T00:00:00.000Z",
    embedding: [0.25, 0.5, 1],
    avatar: "avatars/ada.png",
    editor_id: "e-1",
    editor: { id: "e-1", name: "Grace" },
    profile: { id: "pr-1", bio: "mathematician" },
    posts: [{ id: "p-1", title: "one" }, { id: "p-2", title: "two" }],
    tags: [{ id: "t-1", label: "math", _pivot: { weight: 2 } }, { id: "t-2", label: "poetry", _pivot: { weight: 5 } }]
};

/** A driver that serves {@link SERVED} and records every save as its body would carry it. */
function recordingDriver(saves: SaveProps[]): DataDriver {
    const notUsed = async (): Promise<never> => {
        throw new Error("not used by this test");
    };
    return {
        fetchCollection: notUsed,
        fetchOne: async () => JSON.parse(JSON.stringify(SERVED)),
        save: async (props) => {
            saves.push(JSON.parse(JSON.stringify(props)));
            return { ...JSON.parse(JSON.stringify(props.values)), id: "a-2" };
        },
        delete: notUsed,
        checkUniqueField: notUsed
    };
}

let formContext: FormContext<Author>;
function Capture({ formContext: captured }: EntityCustomViewParams<Author>) {
    formContext = captured;
    return null;
}

describe("Duplicate: what the server receives", () => {
    it("sends wire values only: the belongsTo as its key, many-to-many links as keys, an ISO date, a number vector", async () => {
        const saves: SaveProps[] = [];
        const data = wrapAsEntityData(buildSdkData(recordingDriver(saves)), collectionEntityDataOptions((slug) => collections.get(slug)));

        // The record the table shows, and the Copy action's record of its row.
        const original = await data.table("authors").findById("a-1");
        if (!original) throw new Error("the original did not read back");
        const row = rowOfEntity(original, authors);
        const copied = entityOfRow(row, "a-1", "authors", authors);

        const initialValues = getInitialEntityValues<Author>(
            fakeAuthController({ user: fakeUser("u1") }), authors, "authors", "copy", copied);

        render(<EntityForm<Author>
            path="authors"
            collection={authors}
            row={row}
            initialStatus="copy"
            Builder={Capture}
            computedInitialValues={initialValues}
            onSubmit={saving(async (values: Author) => saveEntityWithCallbacks<Author>({
                path: "authors",
                values,
                collection: authors,
                status: "copy",
                data,
                context: fakeRebaseContext()
            }))}/>);
        await act(async () => {
            formContext.setFieldValue("name", "Ada (copy)");
        });
        await act(async () => {
            await formContext.submit();
        });

        expect(saves).toHaveLength(1);
        expect(saves[0].path).toBe("authors");
        expect(saves[0].status).toBe("new");
        expect(saves[0].values).toEqual({
            name: "Ada (copy)",
            bornAt: "1815-12-10T00:00:00.000Z",
            embedding: [0.25, 0.5, 1],
            avatar: "avatars/ada.png",
            editor_id: "e-1",
            editor: "e-1",
            // A link's `_pivot` is not carried: the view model holds a link
            // as an `EntityRelation`, so the copy's junction rows take their
            // pivot columns' DEFAULT (as on 0.30, where the panel sent the
            // relation objects and the server kept their ids).
            tags: ["t-1", "t-2"]
        });
        // What the copy cannot share is not sent at all: a `hasOne` and a
        // `hasMany` would re-point the original's rows at the copy.
        expect(saves[0].values).not.toHaveProperty("profile");
        expect(saves[0].values).not.toHaveProperty("posts");
        expect(saves[0].values).not.toHaveProperty("id");
    });
});
