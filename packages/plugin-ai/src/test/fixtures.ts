import type { AdminCollection, AuthController, FormContext } from "@rebasepro/cms-types";
import type { User } from "@rebasepro/types";

/**
 * Typed stand-ins for what `<Rebase>` and the entity form hand the plugin.
 */

/** `<Rebase>`'s auth context for a given identity — signed out unless one is passed. */
export function authControllerFor(user: User | null = null): AuthController {
    return {
        user,
        authLoading: false,
        loginSkipped: false,
        signOut: async () => undefined,
        getAuthToken: async () => "",
        extra: undefined,
        setExtra: () => undefined
    };
}

/** The slice of the entity form the provider reads and writes. */
export type FormStandIn = Pick<FormContext, "values" | "setFieldValue">;

export function formStandIn(
    values: Record<string, unknown>,
    setFieldValue: FormContext["setFieldValue"]
): FormStandIn {
    return { values, setFieldValue };
}

/** The part of a `Response` the plugin's transport reads. */
export interface ResponseStandIn {
    ok: boolean;
    status: number;
    json?: () => Promise<unknown>;
    body?: {
        getReader(): { read(): Promise<{ done: boolean, value?: Uint8Array }> };
    };
}

/**
 * Install `answer` as the global `fetch`, and hand back its mock.
 *
 * jsdom has no `fetch` (nor `Response`) of its own, and a stand-in carries only
 * what the transport reads, so it is installed as a property of the global
 * rather than assigned through `fetch`'s own type.
 */
export function installFetch(answer: (url: string, init?: RequestInit) => Promise<ResponseStandIn>) {
    const mock = jest.fn(answer);
    Object.defineProperty(globalThis, "fetch", { value: mock, configurable: true, writable: true });
    return mock;
}

/** A collection of products with a title and a stock count. */
export const PRODUCTS: AdminCollection = {
    slug: "products",
    name: "Products",
    singularName: "Product",
    properties: {
        title: { type: "string", name: "Title" },
        stock: { type: "number", name: "Stock" }
    }
};
