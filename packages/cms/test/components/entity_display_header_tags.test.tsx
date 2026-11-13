/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import type { AdminCollection, Property, Entity } from "@rebasepro/cms-types";

/**
 * A record header's `tags` role, filled by a property, renders through that
 * property — as the status beside it does. An enum path drew its raw id
 * ("unpaid") in an outlined chip while the list showed the label ("Unpaid").
 */

const paymentStatus: Property = {
    type: "string",
    name: "Payment status",
    enum: [
        { id: "unpaid", label: "Unpaid", color: "redLight" },
        { id: "paid", label: "Paid", color: "greenLight" }
    ]
};

const empty = { value: undefined, loading: false };
let tagsRole: { value: unknown; loading: boolean; source?: { key: string; property: Property | undefined; value: unknown } } = empty;

jest.mock("../../src/hooks/useEntityDisplay", () => ({
    useEntityDisplayValues: () => ({
        title: empty,
        subtitle: empty,
        image: empty,
        status: empty,
        date: empty,
        tags: tagsRole,
        loading: false
    })
}));
jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useAuthController: () => ({ user: null }),
        useCustomizationController: () => ({ plugins: [], propertyConfigs: {}, locale: undefined }),
        useAnalyticsController: () => ({}),
        useTranslation: () => ({ t: (key: string) => key })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { EntityDisplayHeader } from "../../src/components/EntityDisplayHeader";

const orders: AdminCollection = {
    slug: "orders",
    name: "Orders",
    properties: { payment_status: paymentStatus },
    display: { tags: "payment_status" }
};

const order: Entity<Record<string, unknown>> = { id: "o1", path: "orders", values: { payment_status: "unpaid" } };

describe("EntityDisplayHeader tags", () => {

    it("shows an enum path by its label, not its id", () => {
        tagsRole = {
            value: "unpaid",
            loading: false,
            source: { key: "payment_status", property: paymentStatus, value: "unpaid" }
        };
        render(<EntityDisplayHeader entity={order} collection={orders}/>);

        expect(screen.getByText("Unpaid")).toBeTruthy();
        expect(screen.queryByText("unpaid")).toBeNull();
    });

    it("shows a computed list as it was returned", () => {
        tagsRole = { value: ["rush", "gift"], loading: false };
        render(<EntityDisplayHeader entity={order} collection={orders}/>);

        expect(screen.getByText("rush")).toBeTruthy();
        expect(screen.getByText("gift")).toBeTruthy();
    });
});
