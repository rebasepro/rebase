/**
 * @jest-environment jsdom
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Formex, useCreateFormex, type FormexController } from "@rebasepro/forms";
import { resolveRelation } from "@rebasepro/common";
import type { CollectionConfig, Property, Relation } from "@rebasepro/types";

import { findCollectionConfigProblems } from "../../../server/src/collections/validate-config";
import { updatePropertyFromWidget } from "../../src/collection_editor/ui/collection_editor/utils/update_property_for_widget";

/**
 * A relation property created in the property form, checked against boot.
 *
 * The form wrote three shapes the boot validator refuses, and the panel
 * reported success for each: a top-level `relationName: ""` (the key moved
 * inside `relation` in 0.11), a relation with no `kind` at all (the select
 * *displayed* "Belongs to" and wrote nothing until it was changed), and, after
 * a kind switch, the old kind's link field left behind — `through` on a
 * `belongsTo`, `localKey` on a `hasMany`. Each one stops every collection in
 * the directory from loading.
 *
 * So the assertion is the boot validator itself, run on what the form holds,
 * and the real `resolveRelation` — the two things a saved collection meets at
 * the next boot. The target is made a thunk first, because that is what the
 * editor writes a picked slug as.
 */

jest.mock("../../src/collection_editor/_cms_internals", () => ({
    FieldCaption: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    useCollectionRegistryController: () => ({
        initialised: true,
        collections: [
            { slug: "authors", name: "Authors", properties: {} },
            { slug: "posts", name: "Posts", properties: {} }
        ]
    })
}));

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => ({ t: (key: string) => key }),
    IconForView: () => null
}));

import { RelationPropertyField } from "../../src/collection_editor/ui/collection_editor/properties/RelationPropertyField";

beforeAll(() => {
    // The kit's Select is Radix-backed and needs pointer capture and
    // scrollIntoView, neither of which jsdom implements.
    Object.assign(Element.prototype, {
        hasPointerCapture: () => false,
        setPointerCapture: () => undefined,
        releasePointerCapture: () => undefined,
        scrollIntoView: () => undefined
    });
});

type PropertyValues = Record<string, unknown> & { relation?: Record<string, unknown> };

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** What choosing the relation widget leaves on a property, as the form holds it. */
function fromWidget(data: Record<string, unknown>): PropertyValues {
    const property: Property = updatePropertyFromWidget(data, "relation", {});
    const relation = "relation" in property ? property.relation : undefined;
    return { ...property, relation: relation ? { ...relation } : undefined };
}

let form: FormexController<PropertyValues>;

function Harness({ initial }: { initial: PropertyValues }) {
    const formex = useCreateFormex<PropertyValues>({ initialValues: initial });
    form = formex;
    return (
        <Formex value={formex}>
            <RelationPropertyField disabled={false} showErrors={false}/>
        </Formex>
    );
}

/** Pick an option from the n-th select on the form, as a user would. */
function choose(selectIndex: number, label: string) {
    fireEvent.click(screen.getAllByRole("combobox")[selectIndex]);
    const option = screen.queryAllByRole("option").find(o => o.textContent?.startsWith(label));
    if (!option) throw new Error(`No "${label}" option. Offered: ${JSON.stringify(screen.queryAllByRole("option").map(o => o.textContent))}`);
    fireEvent.click(option);
}

const TARGET = 0;
const KIND = 1;

const authors = {
    slug: "authors",
    name: "Authors",
    table: "authors",
    properties: { id: { type: "string", isId: true }, name: { type: "string" } }
};

/** The property as the panel sends it, and the collection it lands in as boot reads it. */
function saved(property: PropertyValues) {
    const wire: Record<string, unknown> = JSON.parse(JSON.stringify(property));
    const relation = { ...(isRecord(wire.relation) ? wire.relation : {}), target: () => authors };
    const posts = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        properties: { id: { type: "string", isId: true }, author: { ...wire, relation } }
    };
    return { posts, relation };
}

function bootErrors(property: PropertyValues) {
    return findCollectionConfigProblems([saved(property).posts, authors])
        .filter(p => p.severity === "error")
        .map(p => `${p.path}: ${p.message}`);
}

function resolved(property: PropertyValues) {
    const { posts, relation } = saved(property);
    return resolveRelation(relation as Relation, posts as CollectionConfig, "author");
}

describe("choosing the relation widget", () => {
    it("writes no top-level relationName, and a kind", () => {
        const property = fromWidget({ name: "Author" });

        expect(property).not.toHaveProperty("relationName");
        expect(property.relation).toEqual({ kind: "belongsTo" });
    });

    it("keeps the kind a relation already has", () => {
        const property = fromWidget({ name: "Tags", type: "relation", relation: { kind: "manyToMany", target: "authors" } });

        expect(property.relation).toEqual({ kind: "manyToMany", target: "authors" });
    });
});

describe("a relation property built in the form", () => {
    it("boots when only a target was picked", () => {
        render(<Harness initial={fromWidget({ name: "Author" })}/>);
        choose(TARGET, "AUTHORS");

        expect(form.values.relation).toMatchObject({ kind: "belongsTo", target: "authors" });
        expect(bootErrors(form.values)).toEqual([]);
        expect(resolved(form.values)).toMatchObject({ kind: "belongsTo", targetSlug: "authors" });
    });

    it("stores the kind it displays for a relation that arrived with none", () => {
        render(<Harness initial={{ name: "Author", type: "relation", relation: { target: "authors" } }}/>);

        expect(form.values.relation).toEqual({ target: "authors", relationName: "authors", kind: "belongsTo" });
        expect(bootErrors(form.values)).toEqual([]);
    });

    it("drops the junction table when switched from many-to-many to belongs-to", () => {
        render(<Harness initial={{
            name: "Author",
            type: "relation",
            relation: { kind: "manyToMany", target: "authors", relationName: "author", through: { table: "posts_authors" } }
        }}/>);
        choose(KIND, "Belongs to");

        expect(form.values.relation).toEqual({ kind: "belongsTo", target: "authors", relationName: "author" });
        expect(bootErrors(form.values)).toEqual([]);
    });

    it("drops the local key when switched from belongs-to to has-many", () => {
        render(<Harness initial={{
            name: "Author",
            type: "relation",
            relation: { kind: "belongsTo", target: "authors", relationName: "author", localKey: "author_id", onDelete: "cascade" }
        }}/>);
        choose(KIND, "Has many");

        // The name, the target and the referential actions are every kind's.
        expect(form.values.relation).toEqual({ kind: "hasMany", target: "authors", relationName: "author", onDelete: "cascade" });
        expect(bootErrors(form.values)).toEqual([]);
    });

    it("leaves a junction column it was not given to its default, not to \"\"", () => {
        render(<Harness initial={{
            name: "Author",
            type: "relation",
            relation: { kind: "manyToMany", target: "authors", relationName: "author" }
        }}/>);
        act(() => {
            fireEvent.change(screen.getByLabelText("Junction table name"), { target: { value: "posts_authors" } });
        });

        expect(form.values.relation?.through).toEqual({ table: "posts_authors" });
        expect(bootErrors(form.values)).toEqual([]);
        const link = resolved(form.values);
        if (link.kind !== "manyToMany") throw new Error(`resolved as ${link.kind}`);
        expect(link.through).toMatchObject({ table: "posts_authors", sourceColumn: "post_id", targetColumn: "author_id" });
    });

    it("forgets a key that was typed and cleared, so the default applies again", () => {
        render(<Harness initial={{
            name: "Author",
            type: "relation",
            relation: { kind: "belongsTo", target: "authors", relationName: "author" }
        }}/>);
        const field = screen.getByLabelText("Local key (foreign key column on this table)");
        act(() => {
            fireEvent.change(field, { target: { value: "writer_id" } });
        });
        act(() => {
            fireEvent.change(field, { target: { value: "" } });
        });

        expect(form.values.relation).not.toHaveProperty("localKey");
        const link = resolved(form.values);
        if (link.kind !== "belongsTo") throw new Error(`resolved as ${link.kind}`);
        expect(link.localKey).toBe("author_id");
    });
});
