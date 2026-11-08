/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";
import { EntityRelation } from "@rebasepro/types";
import type { AdminCollection, RebaseContext } from "@rebasepro/cms-types";

/**
 * Code in a collection config is handed the row as the server sends it, never
 * the admin's view model: a display resolver and an additional field's `value`
 * both read a date as ISO text and a belongsTo as its foreign-key column.
 */

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useRebaseContext: () => ({ marker: "context" }),
        useAuthController: () => ({ user: { uid: "u1" } })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { useEntityDisplay } from "../../src/hooks/useEntityDisplay";
import { AdditionalFieldValue } from "../../src/components/AdditionalFieldValue";

const customers: AdminCollection = {
    slug: "row_customers",
    name: "Customers",
    properties: { id: { type: "string", name: "Id", isId: true }, name: { type: "string", name: "Name" } }
};

function ordersWith(subtitle: (params: { row: Record<string, unknown> }) => string): AdminCollection {
    return {
        slug: "row_orders",
        name: "Orders",
        properties: {
            id: { type: "string", name: "Id", isId: true },
            placed_on: { type: "date", name: "Placed on", columnType: "date" },
            customer: { type: "relation", name: "Customer", relation: { kind: "belongsTo", target: () => customers, localKey: "customer_id" } }
        },
        display: { subtitle }
    };
}

function order(id: string): Entity {
    return {
        id,
        path: "row_orders",
        values: {
            id,
            placed_on: new Date("2026-11-08"),
            customer: new EntityRelation("c7", "row_customers", { id: "c7", path: "row_customers", values: { name: "Ada" } })
        }
    };
}

describe("an admin.display resolver", () => {
    it("is handed the row: an ISO date, the foreign-key column, and the loaded relation nested under its name", async () => {
        const seen: Record<string, unknown>[] = [];
        const collection = ordersWith(({ row }) => {
            seen.push(row);
            return `${String(row.customerId)} on ${String(row.placed_on)}`;
        });
        const { result } = renderHook(() => useEntityDisplay<string>("subtitle", { collection, entity: order("o1") }));

        await waitFor(() => expect(result.current.value).toBe("c7 on 2026-11-08"));
        expect(seen[0]).toEqual({
            id: "o1",
            placed_on: "2026-11-08",
            customerId: "c7",
            customer: { id: "c7", name: "Ada" }
        });
    });

    it("reads a related record's field off the row, with no request of its own", async () => {
        const collection = ordersWith(({ row }) => {
            const customer = row.customer;
            return customer !== null && typeof customer === "object" && "name" in customer ? String(customer.name) : "not loaded";
        });
        const { result } = renderHook(() => useEntityDisplay<string>("subtitle", { collection, entity: order("o2") }));
        await waitFor(() => expect(result.current.value).toBe("Ada"));
    });
});

describe("an additional field's value", () => {
    it("is handed the row it is drawn for", async () => {
        const value = jest.fn(({ row }: { row: Record<string, unknown> }) => `${String(row.id)}:${String(row.placed_on)}`);
        render(<AdditionalFieldValue
            field={{ key: "label", name: "Label", value }}
            row={{ id: "o2", placed_on: "2026-11-08" }}
            context={{} as RebaseContext}/>);

        expect(await screen.findByText("o2:2026-11-08")).toBeTruthy();
        expect(value.mock.calls[0][0].row).toEqual({ id: "o2", placed_on: "2026-11-08" });
    });
});
