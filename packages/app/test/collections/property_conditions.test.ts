import { applyPropertyConditions, isDisabled, isHidden, isReadOnly } from "../../src/collections/property_presentation";
import { registerConditionOperations } from "@rebasepro/cms-types";
import type { EnumValueConfig, Property, PropertyConditions } from "@rebasepro/types";
import type { ConditionContext } from "@rebasepro/cms-types";

/** The enum options a resolved property carries, as the array form the conditions write. */
function enumOptions(property: Property): EnumValueConfig[] {
    if (property.type !== "string" && property.type !== "number") throw new Error(`a ${property.type} property has no enum`);
    if (!Array.isArray(property.enum)) throw new Error("expected the enum as an array");
    return property.enum;
}

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
        const property: Property = {
            type: "string",
            name: "Title",
            conditions: {
                disabled: { "==": [{ "var": "values.status" }, "archived"] },
                disabledMessage: "Cannot edit archived items"
            }
        };

        const result = applyPropertyConditions(property, baseContext);

        expect(result.admin?.disabled).toEqual({
            clearOnDisabled: false,
            disabledMessage: "Cannot edit archived items",
            hidden: false
        });
    });

    it("should apply hidden condition", () => {
        const property: Property = {
            type: "string",
            name: "Internal Notes",
            conditions: {
                hidden: { "==": [{ "var": "values.status" }, "archived"] }
            }
        };

        const result = applyPropertyConditions(property, baseContext);

        expect(result.admin?.disabled).toEqual(expect.objectContaining({
            hidden: true
        }));
    });

    it("should apply required condition", () => {
        const property: Property = {
            type: "string",
            name: "Email",
            conditions: {
                required: { "!!": { "var": "values.status" } }
            }
        };

        const result = applyPropertyConditions(property, baseContext);

        expect(result.validation?.required).toBe(true);
    });

    it("should not apply disabled when condition is false", () => {
        const property: Property = {
            type: "string",
            name: "Title",
            conditions: {
                disabled: { "==": [{ "var": "values.status" }, "draft"] }
            }
        };

        const result = applyPropertyConditions(property, baseContext);

        expect(result.admin?.disabled).toBeUndefined();
    });

    it("should apply enum conditions to filter values", () => {
        const property: Property = {
            type: "string",
            name: "Category",
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
        };

        const result = applyPropertyConditions(property, baseContext);

        expect(enumOptions(result)).toHaveLength(2);
        expect(enumOptions(result).map((e) => e.id)).toEqual(["electronics", "clothing"]);
    });

    it("should apply enum conditions with object format (Firestore workaround)", () => {
        const property: Property = {
            type: "string",
            name: "Category",
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
        };

        const result = applyPropertyConditions(property, baseContext);

        expect(enumOptions(result)).toHaveLength(2);
        expect(enumOptions(result).map((e) => e.id)).toEqual(["electronics", "clothing"]);
    });

    it("should apply excludedEnumValues to remove specific values", () => {
        const property: Property = {
            type: "string",
            name: "Status",
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
        };

        const result = applyPropertyConditions(property, baseContext);

        expect(enumOptions(result)).toHaveLength(2);
        expect(enumOptions(result).map((e) => e.id)).toEqual(["draft", "archived"]);
    });

    it("should apply enum conditions to disable specific values", () => {
        const property: Property = {
            type: "string",
            name: "Status",
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
        };

        const result = applyPropertyConditions(property, baseContext);
        const archivedOption = enumOptions(result).find((e) => e.id === "archived");
        expect(archivedOption!.disabled).toBeFalsy();

        const contextDraft = { ...baseContext,
values: { status: "draft" } };
        const resultDraft = applyPropertyConditions(property, contextDraft);
        const archivedOptionDraft = enumOptions(resultDraft).find((e) => e.id === "archived");
        expect(archivedOptionDraft!.disabled).toBe(true);
    });

    it("should handle multiple conditions together", () => {
        const property: Property = {
            type: "string",
            name: "Notes",
            conditions: {
                disabled: { "==": [{ "var": "values.status" }, "archived"] },
                required: { "==": [{ "var": "values.status" }, "published"] },
                disabledMessage: "Cannot edit notes on archived items"
            }
        };

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
        const property: Property = {
            type: "string",
            name: "Title",
            conditions: {
                disabled: { "==": [{ "var": "values.status" }, "archived"] },
                clearOnDisabled: true
            }
        };

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
        const property: Property = {
            type: "string",
            name: "SKU",
            conditions: {
                readOnly: { "==": [{ "var": "values.status" }, "archived"] }
            }
        };

        const result = applyPropertyConditions(property, baseContext);
        expect(result.admin?.readOnly).toBe(true);
    });

    it("should not set readOnly when condition evaluates to false", () => {
        const property: Property = {
            type: "string",
            name: "SKU",
            conditions: {
                readOnly: { "==": [{ "var": "values.status" }, "draft"] }
            }
        };

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

        const property: Property = {
            type: "string",
            name: "Status",
            conditions: {
                // A rule that always answers "draft".
                defaultValue: { cat: ["draft"] }
            }
        };

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

        const property: Property = {
            type: "string",
            name: "Status",
            conditions: {
                // A rule that always answers "draft".
                defaultValue: { cat: ["draft"] }
            }
        };

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
        const property: Property = {
            type: "reference",
            name: "Related",
            conditions: {
                referencePath: { "var": "values.category" }
            }
        };

        const result = applyPropertyConditions(property, baseContext);
        expect(result.type === "reference" && result.path).toBe("electronics");
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
        const property: Property = {
            type: "array",
            name: "Tags",
            conditions: {
                canAddElements: { "!=": [{ "var": "values.status" }, "locked"] }
            }
        };

        const result = applyPropertyConditions(property, baseContext);
        expect(result.type === "array" && result.admin?.canAddElements).toBe(false);
    });

    it("should set sortable based on condition", () => {
        const property: Property = {
            type: "array",
            name: "Items",
            conditions: {
                sortable: { "!=": [{ "var": "values.status" }, "locked"] }
            }
        };

        const result = applyPropertyConditions(property, baseContext);
        expect(result.type === "array" && result.admin?.sortable).toBe(false);
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
        const property: Property = {
            type: "string",
            name: "Role",
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
        };

        const result = applyPropertyConditions(property, baseContext);
        const enums = enumOptions(result);
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

    const p = (conditions: PropertyConditions): Property => ({ type: "string", name: "Field", conditions });

    it("hides a field declared `hidden: true`", () => {
        expect(isHidden(p({ hidden: true }))).toBe(true);
        expect(isHidden(p({ hidden: false }))).toBe(false);
        expect(isHidden(p({}))).toBe(false);
    });

    it("keeps honouring the admin block it used to be the only reader of", () => {
        expect(isHidden({ type: "string", admin: { disabled: { hidden: true } } })).toBe(true);
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
        expect(isDisabled({ type: "string", admin: { disabled: true } })).toBe(true);
    });

    it("takes a literal through the rule evaluator unchanged", () => {
        // It must not hand a boolean to json-logic and get a rule's answer.
        const result = applyPropertyConditions(p({ hidden: true }), baseContextForLiterals);
        expect(result.admin?.disabled).toMatchObject({ hidden: true });
        expect(applyPropertyConditions(p({ hidden: false }), baseContextForLiterals).admin?.disabled)
            .toBeUndefined();
    });
});

describe("applyPropertyConditions — what the record form reads", () => {
    const context = (values: Record<string, unknown>): ConditionContext => ({
        ...baseContextForLiterals,
        values
    });

    it("never writes into the collection's own admin block", () => {
        // Shared by every record the form opens: a rule that disabled one
        // record's field must not disable it for the next one.
        const admin = { multiline: true };
        const property: Property = {
            type: "string",
            admin,
            conditions: { disabled: { "==": [{ var: "values.locked" }, true] }, readOnly: true }
        };
        applyPropertyConditions(property, context({ locked: true }));
        expect(admin).toEqual({ multiline: true });
        expect(applyPropertyConditions(property, context({ locked: false })).admin?.disabled).toBeUndefined();
    });

    it("applies a min and a max rule as the validation bounds", () => {
        const property: Property = {
            type: "number",
            validation: { required: true },
            conditions: { min: { if: [{ var: "values.wholesale" }, 10, 1] }, max: 100 }
        };
        expect(applyPropertyConditions(property, context({ wholesale: true })).validation)
            .toEqual({ required: true, min: 10, max: 100 });
        expect(applyPropertyConditions(property, context({ wholesale: false })).validation)
            .toEqual({ required: true, min: 1, max: 100 });
    });

    it("keeps the declared required message when the rule names none", () => {
        const property: Property = {
            type: "string",
            validation: { requiredMessage: "Give it a name" },
            conditions: { required: true }
        };
        expect(applyPropertyConditions(property, context({})).validation)
            .toEqual({ required: true, requiredMessage: "Give it a name" });
    });

    it("applies the accepted file types and size limit to an upload", () => {
        const storage = { storagePath: "docs", acceptedFiles: ["image/*"] };
        const property: Property = {
            type: "string",
            storage,
            conditions: {
                acceptedFiles: { if: [{ var: "values.pdf" }, ["application/pdf"], ["image/*"]] },
                maxFileSize: 1024
            }
        };
        const result = applyPropertyConditions(property, context({ pdf: true }));
        expect(result.type === "string" && result.storage).toEqual({ storagePath: "docs", acceptedFiles: ["application/pdf"], maxSize: 1024 });
        expect(storage).toEqual({ storagePath: "docs", acceptedFiles: ["image/*"] });
    });
});
