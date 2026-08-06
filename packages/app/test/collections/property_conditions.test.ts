import { applyPropertyConditions, isDisabled, isHidden, isReadOnly } from "../../src/collections/property_presentation";
import { registerConditionOperations } from "@rebasepro/common";
import type { ConditionContext, Property } from "@rebasepro/types";

// applyPropertyConditions moved here with the function: it writes into a property's
// admin block, so it has no business in a package the backend depends on.
registerConditionOperations();

const baseContextForLiterals: ConditionContext = {
    values: {},
    previousValues: {},
    propertyValue: undefined,
    path: "products",
    entityId: "123",
    isNew: false,
    user: { uid: "user1", email: null, displayName: null, photoURL: null, roles: [] },
    now: 0
};

describe("applyPropertyConditions", () => {

    const baseContext: ConditionContext = {
        values: { status: "archived" },
        previousValues: {},
        propertyValue: undefined,
        path: "products",
        entityId: "123",
        isNew: false,
        user: { uid: "user1",
email: null,
displayName: null,
photoURL: null,
roles: ["admin"] },
        now: Date.now()
    };

    it("should apply disabled condition", () => {
        const property = {
            type: "string",
            name: "Title",
            resolved: true,
            fromBuilder: false,
            conditions: {
                disabled: { "==": [{ "var": "values.status" }, "archived"] },
                disabledMessage: "Cannot edit archived items"
            }
        } as unknown as Property;

        const result = applyPropertyConditions(property, baseContext);

        expect(result.admin?.disabled).toEqual({
            clearOnDisabled: false,
            disabledMessage: "Cannot edit archived items",
            hidden: false
        });
    });

    it("should apply hidden condition", () => {
        const property = {
            type: "string",
            name: "Internal Notes",
            resolved: true,
            fromBuilder: false,
            conditions: {
                hidden: { "==": [{ "var": "values.status" }, "archived"] }
            }
        } as unknown as Property;

        const result = applyPropertyConditions(property, baseContext);

        expect(result.admin?.disabled).toEqual(expect.objectContaining({
            hidden: true
        }));
    });

    it("should apply required condition", () => {
        const property = {
            type: "string",
            name: "Email",
            resolved: true,
            fromBuilder: false,
            conditions: {
                required: { "!!": { "var": "values.status" } }
            }
        } as unknown as Property;

        const result = applyPropertyConditions(property, baseContext);

        expect(result.validation?.required).toBe(true);
    });

    it("should not apply disabled when condition is false", () => {
        const property = {
            type: "string",
            name: "Title",
            resolved: true,
            fromBuilder: false,
            conditions: {
                disabled: { "==": [{ "var": "values.status" }, "draft"] }
            }
        } as unknown as Property;

        const result = applyPropertyConditions(property, baseContext);

        expect(result.admin?.disabled).toBeUndefined();
    });

    it("should apply enum conditions to filter values", () => {
        const property = {
            type: "string",
            name: "Category",
            resolved: true,
            fromBuilder: false,
            enum: [
                { id: "electronics",
label: "Electronics" },
                { id: "clothing",
label: "Clothing" },
                { id: "food",
label: "Food" }
            ],
            conditions: {
                allowedEnumValues: ["electronics", "clothing"]
            }
        } as unknown as Property;

        const result = applyPropertyConditions(property, baseContext);

        expect((result as Record<string, unknown>)["enum"]).toHaveLength(2);
        expect(((result as Record<string, unknown>)["enum"] as EnumValueConfig[]).map((e) => e.id)).toEqual(["electronics", "clothing"]);
    });

    it("should apply enum conditions with object format (Firestore workaround)", () => {
        const property = {
            type: "string",
            name: "Category",
            resolved: true,
            fromBuilder: false,
            enum: [
                { id: "electronics",
label: "Electronics" },
                { id: "clothing",
label: "Clothing" },
                { id: "food",
label: "Food" }
            ],
            conditions: {
                allowedEnumValues: {
                    "if": [
                        { "!!": { "var": "values.status" } },
                        { "0": "electronics",
"1": "clothing" },
                        { "0": "electronics",
"1": "clothing",
"2": "food" }
                    ]
                }
            }
        } as unknown as Property;

        const result = applyPropertyConditions(property, baseContext);

        expect((result as Record<string, unknown>)["enum"]).toHaveLength(2);
        expect(((result as Record<string, unknown>)["enum"] as EnumValueConfig[]).map((e) => e.id)).toEqual(["electronics", "clothing"]);
    });

    it("should apply excludedEnumValues to remove specific values", () => {
        const property = {
            type: "string",
            name: "Status",
            resolved: true,
            fromBuilder: false,
            enum: [
                { id: "draft",
label: "Draft" },
                { id: "published",
label: "Published" },
                { id: "archived",
label: "Archived" }
            ],
            conditions: {
                // Simple array of excluded values
                excludedEnumValues: ["published"]
            }
        } as unknown as Property;

        const result = applyPropertyConditions(property, baseContext);

        expect((result as Record<string, unknown>)["enum"]).toHaveLength(2);
        expect(((result as Record<string, unknown>)["enum"] as EnumValueConfig[]).map((e) => e.id)).toEqual(["draft", "archived"]);
    });

    it("should apply enum conditions to disable specific values", () => {
        const property = {
            type: "string",
            name: "Status",
            resolved: true,
            fromBuilder: false,
            enum: [
                { id: "draft",
label: "Draft" },
                { id: "published",
label: "Published" },
                { id: "archived",
label: "Archived" }
            ],
            conditions: {
                enumConditions: {
                    archived: {
                        disabled: { "!=": [{ "var": "values.status" }, "archived"] }
                    }
                }
            }
        } as unknown as Property;

        const result = applyPropertyConditions(property, baseContext);
        const archivedOption = ((result as Record<string, unknown>)["enum"] as EnumValueConfig[]).find((e) => e.id === "archived");
        expect(archivedOption!.disabled).toBeFalsy();

        const contextDraft = { ...baseContext,
values: { status: "draft" } };
        const resultDraft = applyPropertyConditions(property, contextDraft);
        const archivedOptionDraft = ((resultDraft as Record<string, unknown>)["enum"] as EnumValueConfig[]).find((e) => e.id === "archived");
        expect(archivedOptionDraft!.disabled).toBe(true);
    });

    it("should handle multiple conditions together", () => {
        const property = {
            type: "string",
            name: "Notes",
            resolved: true,
            fromBuilder: false,
            conditions: {
                disabled: { "==": [{ "var": "values.status" }, "archived"] },
                required: { "==": [{ "var": "values.status" }, "published"] },
                disabledMessage: "Cannot edit notes on archived items"
            }
        } as unknown as Property;

        const resultArchived = applyPropertyConditions(property, baseContext);
        expect(resultArchived.admin?.disabled).toBeDefined();
        expect(resultArchived.validation?.required).toBeFalsy();

        const contextPublished = { ...baseContext,
values: { status: "published" } };
        const resultPublished = applyPropertyConditions(property, contextPublished);
        expect(resultPublished.admin?.disabled).toBeUndefined();
        expect(resultPublished.validation?.required).toBe(true);
    });

    it("should handle clearOnDisabled option", () => {
        const property = {
            type: "string",
            name: "Title",
            resolved: true,
            fromBuilder: false,
            conditions: {
                disabled: { "==": [{ "var": "values.status" }, "archived"] },
                clearOnDisabled: true
            }
        } as unknown as Property;

        const result = applyPropertyConditions(property, baseContext);

        expect(result.admin?.disabled).toEqual(expect.objectContaining({
            clearOnDisabled: true
        }));
    });
});

describe("applyPropertyConditions — readOnly condition", () => {
    const baseContext: ConditionContext = {
        values: { status: "archived" },
        previousValues: {},
        propertyValue: undefined,
        path: "products",
        entityId: "123",
        isNew: false,
        user: { uid: "user1",
email: null,
displayName: null,
photoURL: null,
roles: ["admin"] },
        now: Date.now()
    };

    it("should set readOnly when condition evaluates to true", () => {
        const property = {
            type: "string",
            name: "SKU",
            resolved: true,
            fromBuilder: false,
            conditions: {
                readOnly: { "==": [{ "var": "values.status" }, "archived"] }
            }
        } as unknown as Property;

        const result = applyPropertyConditions(property, baseContext);
        expect(result.admin?.readOnly).toBe(true);
    });

    it("should not set readOnly when condition evaluates to false", () => {
        const property = {
            type: "string",
            name: "SKU",
            resolved: true,
            fromBuilder: false,
            conditions: {
                readOnly: { "==": [{ "var": "values.status" }, "draft"] }
            }
        } as unknown as Property;

        const result = applyPropertyConditions(property, baseContext);
        expect(result.admin?.readOnly).toBeUndefined();
    });
});

describe("applyPropertyConditions — defaultValue condition", () => {
    it("should set defaultValue for new entities", () => {
        const context: ConditionContext = {
            values: {},
            previousValues: {},
            propertyValue: undefined,
            path: "products",
            isNew: true,
            user: { uid: "u1",
email: null,
displayName: null,
photoURL: null,
roles: [] },
            now: Date.now()
        };

        const property = {
            type: "string",
            name: "Status",
            resolved: true,
            fromBuilder: false,
            conditions: {
                defaultValue: "draft"
            }
        } as unknown as Property;

        const result = applyPropertyConditions(property, context);
        expect(result.defaultValue).toBe("draft");
    });

    it("should NOT set defaultValue for existing entities", () => {
        const context: ConditionContext = {
            values: { status: "published" },
            previousValues: {},
            propertyValue: undefined,
            path: "products",
            entityId: "123",
            isNew: false,
            user: { uid: "u1",
email: null,
displayName: null,
photoURL: null,
roles: [] },
            now: Date.now()
        };

        const property = {
            type: "string",
            name: "Status",
            resolved: true,
            fromBuilder: false,
            conditions: {
                defaultValue: "draft"
            }
        } as unknown as Property;

        const result = applyPropertyConditions(property, context);
        expect(result.defaultValue).toBeUndefined();
    });
});

describe("applyPropertyConditions — reference conditions", () => {
    const baseContext: ConditionContext = {
        values: { category: "electronics" },
        previousValues: {},
        propertyValue: undefined,
        path: "products",
        entityId: "123",
        isNew: false,
        user: { uid: "u1",
email: null,
displayName: null,
photoURL: null,
roles: [] },
        now: Date.now()
    };

    it("should set dynamic reference path", () => {
        const property = {
            type: "reference",
            name: "Related",
            resolved: true,
            fromBuilder: false,
            conditions: {
                referencePath: { "var": "values.category" }
            }
        } as unknown as Property;

        const result = applyPropertyConditions(property, baseContext);
        expect((result as any).path).toBe("electronics");
    });
});

describe("applyPropertyConditions — array conditions", () => {
    const baseContext: ConditionContext = {
        values: { status: "locked" },
        previousValues: {},
        propertyValue: undefined,
        path: "products",
        entityId: "123",
        isNew: false,
        user: { uid: "u1",
email: null,
displayName: null,
photoURL: null,
roles: [] },
        now: Date.now()
    };

    it("should disable adding elements when condition evaluates to false", () => {
        const property = {
            type: "array",
            name: "Tags",
            resolved: true,
            fromBuilder: false,
            conditions: {
                canAddElements: { "!=": [{ "var": "values.status" }, "locked"] }
            }
        } as unknown as Property;

        const result = applyPropertyConditions(property, baseContext);
        expect((result as any).admin?.canAddElements).toBe(false);
    });

    it("should set sortable based on condition", () => {
        const property = {
            type: "array",
            name: "Items",
            resolved: true,
            fromBuilder: false,
            conditions: {
                sortable: { "!=": [{ "var": "values.status" }, "locked"] }
            }
        } as unknown as Property;

        const result = applyPropertyConditions(property, baseContext);
        expect((result as any).admin?.sortable).toBe(false);
    });
});

describe("applyPropertyConditions — enum hidden condition", () => {
    const baseContext: ConditionContext = {
        values: { role: "viewer" },
        previousValues: {},
        propertyValue: undefined,
        path: "users",
        entityId: "123",
        isNew: false,
        user: { uid: "u1",
email: null,
displayName: null,
photoURL: null,
roles: [] },
        now: Date.now()
    };

    it("should hide enum values when hidden condition is true", () => {
        const property = {
            type: "string",
            name: "Role",
            resolved: true,
            fromBuilder: false,
            enum: [
                { id: "admin",
label: "Admin" },
                { id: "editor",
label: "Editor" },
                { id: "viewer",
label: "Viewer" }
            ],
            conditions: {
                enumConditions: {
                    admin: {
                        hidden: { "==": [{ "var": "values.role" }, "viewer"] }
                    }
                }
            }
        } as unknown as Property;

        const result = applyPropertyConditions(property, baseContext);
        const enums = (result as any).enum as { id: string }[];
        expect(enums.map(e => e.id)).not.toContain("admin");
        expect(enums.map(e => e.id)).toContain("editor");
        expect(enums.map(e => e.id)).toContain("viewer");
    });
});

/**
 * A condition stated as a literal rather than as a rule.
 *
 * The unconditional case — "never editable", "never shown" — had to be spelled
 * `{ "==": [1, 1] }`, which is a puzzle at the call site and reads as a mistake
 * to the next person. A plain `true` says it, and because a literal needs no
 * context it is answered by the same three gates that lay every field out,
 * without waiting for the rule evaluator to be wired up.
 */
describe("literal conditions", () => {

    const p = (conditions: Record<string, unknown>, rest: Record<string, unknown> = {}) =>
        ({ type: "string", name: "Field", conditions, ...rest } as unknown as Property);

    it("hides a field declared `hidden: true`", () => {
        expect(isHidden(p({ hidden: true }))).toBe(true);
        expect(isHidden(p({ hidden: false }))).toBe(false);
        expect(isHidden(p({}))).toBe(false);
    });

    it("keeps honouring the admin block it used to be the only reader of", () => {
        expect(isHidden({ type: "string", admin: { disabled: { hidden: true } } } as unknown as Property)).toBe(true);
    });

    it("does not read a rule as an answer", () => {
        // A rule is truthy as an object. Evaluating it needs an entity to
        // evaluate against, which a gate this shallow does not have — so it must
        // decline rather than guess, and `hidden: {...}` is not `hidden: true`.
        expect(isHidden(p({ hidden: { "==": [1, 1] } }))).toBe(false);
        expect(isReadOnly(p({ readOnly: { "==": [1, 1] } }))).toBe(false);
        expect(isDisabled(p({ disabled: { "==": [1, 1] } }))).toBe(false);
    });

    it("freezes a field declared `readOnly: true`", () => {
        expect(isReadOnly(p({ readOnly: true }))).toBe(true);
        expect(isReadOnly(p({ readOnly: false }))).toBe(false);
    });

    it("disables a field declared `disabled: true`", () => {
        expect(isDisabled(p({ disabled: true }))).toBe(true);
        expect(isDisabled(p({ disabled: false }))).toBe(false);
        // The other way of saying it, unchanged.
        expect(isDisabled({ type: "string", admin: { disabled: true } } as unknown as Property)).toBe(true);
    });

    it("takes a literal through the rule evaluator unchanged", () => {
        // `applyPropertyConditions` is not wired up in production, but when it is
        // it must not hand a boolean to json-logic and get a rule's answer.
        const result = applyPropertyConditions(p({ hidden: true }), baseContextForLiterals);
        expect(result.admin?.disabled).toMatchObject({ hidden: true });
        expect(applyPropertyConditions(p({ hidden: false }), baseContextForLiterals).admin?.disabled)
            .toBeUndefined();
    });
});
