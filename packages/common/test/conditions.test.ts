import {
    applyPropertyConditions,
    buildConditionContext,
    evaluateCondition,
    registerConditionOperations
} from "../src/util/conditions";
import { AuthController, ConditionContext, EnumValueConfig, Property, StringProperty } from "../../types";

describe("Property Conditions", () => {

    beforeAll(() => {
        registerConditionOperations();
    });

    describe("evaluateCondition", () => {

        it("should evaluate simple equality", () => {
            const context: ConditionContext = {
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
roles: [] },
                now: Date.now()
            };

            const rule = { "==": [{ "var": "values.status" }, "archived"] };
            expect(evaluateCondition(rule, context)).toBe(true);
        });

        it("should evaluate var access to nested values", () => {
            const context: ConditionContext = {
                values: { shipping: { method: "pickup" } },
                previousValues: {},
                propertyValue: undefined,
                path: "orders",
                isNew: false,
                user: { uid: "user1",
email: null,
displayName: null,
photoURL: null,
roles: [] },
                now: Date.now()
            };

            const rule = { "==": [{ "var": "values.shipping.method" }, "pickup"] };
            expect(evaluateCondition(rule, context)).toBe(true);
        });

        it("should check isNew status", () => {
            const contextNew: ConditionContext = {
                values: {},
                previousValues: {},
                propertyValue: undefined,
                path: "products",
                isNew: true,
                user: { uid: "user1",
email: null,
displayName: null,
photoURL: null,
roles: [] },
                now: Date.now()
            };

            const rule = { "var": "isNew" };
            expect(evaluateCondition(rule, contextNew)).toBe(true);

            const contextExisting: ConditionContext = {
                ...contextNew,
                entityId: "123",
                isNew: false
            };
            expect(evaluateCondition(rule, contextExisting)).toBe(false);
        });

        it("should handle if/then/else with object values (Firestore workaround)", () => {
            const context: ConditionContext = {
                values: { status: "active" },
                previousValues: {},
                propertyValue: undefined,
                path: "products",
                isNew: false,
                user: { uid: "user1",
email: null,
displayName: null,
photoURL: null,
roles: [] },
                now: Date.now()
            };

            // Firestore stores arrays as objects like {"0": "a", "1": "b"}
            const rule = {
                "if": [
                    { "==": [{ "var": "values.status" }, "active"] },
                    { "0": "electronics",
"1": "clothing" },
                    { "0": "electronics",
"1": "clothing",
"2": "food" }
                ]
            };

            const result = evaluateCondition(rule, context);
            expect(result).toEqual({ "0": "electronics",
"1": "clothing" });
        });

        it("should evaluate truthy operator (!!)", () => {
            const context: ConditionContext = {
                values: { name: "Product",
emptyField: "" },
                previousValues: {},
                propertyValue: undefined,
                path: "products",
                isNew: false,
                user: { uid: "user1",
email: null,
displayName: null,
photoURL: null,
roles: [] },
                now: Date.now()
            };

            expect(evaluateCondition({ "!!": { "var": "values.name" } }, context)).toBe(true);
            expect(evaluateCondition({ "!!": { "var": "values.emptyField" } }, context)).toBe(false);
        });

        it("should evaluate falsy operator (!)", () => {
            const context: ConditionContext = {
                values: { name: "Product",
emptyField: "" },
                previousValues: {},
                propertyValue: undefined,
                path: "products",
                isNew: false,
                user: { uid: "user1",
email: null,
displayName: null,
photoURL: null,
roles: [] },
                now: Date.now()
            };

            expect(evaluateCondition({ "!": { "var": "values.name" } }, context)).toBe(false);
            expect(evaluateCondition({ "!": { "var": "values.emptyField" } }, context)).toBe(true);
        });

        it("should evaluate greater than operator", () => {
            const context: ConditionContext = {
                values: { price: 100 },
                previousValues: {},
                propertyValue: undefined,
                path: "products",
                isNew: false,
                user: { uid: "user1",
email: null,
displayName: null,
photoURL: null,
roles: [] },
                now: Date.now()
            };

            expect(evaluateCondition({ ">": [{ "var": "values.price" }, 50] }, context)).toBe(true);
            expect(evaluateCondition({ ">": [{ "var": "values.price" }, 100] }, context)).toBe(false);
        });

        it("should evaluate in operator with array", () => {
            const context: ConditionContext = {
                values: { category: "electronics" },
                previousValues: {},
                propertyValue: undefined,
                path: "products",
                isNew: false,
                user: { uid: "user1",
email: null,
displayName: null,
photoURL: null,
roles: [] },
                now: Date.now()
            };

            expect(evaluateCondition({ "in": [{ "var": "values.category" }, ["electronics", "clothing"]] }, context)).toBe(true);
            expect(evaluateCondition({ "in": [{ "var": "values.category" }, ["food", "toys"]] }, context)).toBe(false);
        });
    });

    describe("Custom operations", () => {

        it("isPast should check if timestamp is in the past", () => {
            const context: ConditionContext = {
                values: {},
                previousValues: {},
                propertyValue: undefined,
                path: "products",
                isNew: false,
                user: { uid: "user1",
email: null,
displayName: null,
photoURL: null,
roles: [] },
                now: Date.now()
            };

            const pastTimestamp = Date.now() - 86400000;
            const futureTimestamp = Date.now() + 86400000;

            expect(evaluateCondition({ "isPast": pastTimestamp }, context)).toBe(true);
            expect(evaluateCondition({ "isPast": futureTimestamp }, context)).toBe(false);
        });

        it("isFuture should check if timestamp is in the future", () => {
            const context: ConditionContext = {
                values: {},
                previousValues: {},
                propertyValue: undefined,
                path: "products",
                isNew: false,
                user: { uid: "user1",
email: null,
displayName: null,
photoURL: null,
roles: [] },
                now: Date.now()
            };

            const pastTimestamp = Date.now() - 86400000;
            const futureTimestamp = Date.now() + 86400000;

            expect(evaluateCondition({ "isFuture": futureTimestamp }, context)).toBe(true);
            expect(evaluateCondition({ "isFuture": pastTimestamp }, context)).toBe(false);
        });
    });

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

            expect(result.ui?.disabled).toEqual({
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

            expect(result.ui?.disabled).toEqual(expect.objectContaining({
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

            expect(result.ui?.disabled).toBeUndefined();
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
            expect(resultArchived.ui?.disabled).toBeDefined();
            expect(resultArchived.validation?.required).toBeFalsy();

            const contextPublished = { ...baseContext,
values: { status: "published" } };
            const resultPublished = applyPropertyConditions(property, contextPublished);
            expect(resultPublished.ui?.disabled).toBeUndefined();
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

            expect(result.ui?.disabled).toEqual(expect.objectContaining({
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
            expect(result.ui?.readOnly).toBe(true);
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
            expect(result.ui?.readOnly).toBeUndefined();
        });
    });

    describe("applyPropertyConditions — defaultValue condition", () => {
        it("should set defaultValue for new entitys", () => {
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

        it("should NOT set defaultValue for existing entitys", () => {
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
            expect((result as any).canAddElements).toBe(false);
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
            expect((result as any).sortable).toBe(false);
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

    describe("buildConditionContext — serialization edge cases", () => {
        it("should serialize Firestore Timestamp-like objects with toMillis", () => {
            const mockAuthController = { user: null };
            const fakeTimestamp = { toMillis: () => 1700000000000 };

            const context = buildConditionContext({
                path: "products",
                values: { createdAt: fakeTimestamp },
                authController: mockAuthController as AuthController
            });

            expect(context.values.createdAt).toBe(1700000000000);
        });

        it("should serialize Firestore Timestamp-like objects with toDate", () => {
            const mockAuthController = { user: null };
            const date = new Date("2024-06-15T12:00:00Z");
            const fakeTimestamp = { toDate: () => date };

            const context = buildConditionContext({
                path: "products",
                values: { updatedAt: fakeTimestamp },
                authController: mockAuthController as AuthController
            });

            expect(context.values.updatedAt).toBe(date.getTime());
        });

        it("should recursively serialize nested objects", () => {
            const mockAuthController = { user: null };
            const now = new Date();

            const context = buildConditionContext({
                path: "products",
                values: { meta: { created: now,
updated: now } },
                authController: mockAuthController as AuthController
            });

            expect((context.values.meta as any).created).toBe(now.getTime());
            expect((context.values.meta as any).updated).toBe(now.getTime());
        });

        it("should recursively serialize arrays", () => {
            const mockAuthController = { user: null };
            const d1 = new Date("2024-01-01");
            const d2 = new Date("2024-02-01");

            const context = buildConditionContext({
                path: "products",
                values: { dates: [d1, d2] },
                authController: mockAuthController as AuthController
            });

            expect(context.values.dates).toEqual([d1.getTime(), d2.getTime()]);
        });

        it("should set propertyValue from propertyKey", () => {
            const mockAuthController = { user: null };

            const context = buildConditionContext({
                path: "products",
                propertyKey: "title",
                values: { title: "Hello World" },
                authController: mockAuthController as AuthController
            });

            expect(context.propertyValue).toBe("Hello World");
        });

        it("should use values as previousValues when previousValues is undefined", () => {
            const mockAuthController = { user: null };

            const context = buildConditionContext({
                path: "products",
                values: { title: "Current" },
                authController: mockAuthController as AuthController
            });

            expect(context.previousValues).toEqual({ title: "Current" });
        });

        it("should include index when provided", () => {
            const mockAuthController = { user: null };

            const context = buildConditionContext({
                path: "products",
                index: 3,
                authController: mockAuthController as AuthController
            });

            expect(context.index).toBe(3);
        });

        it("should include string roles from user", () => {
            const mockAuthController = {
                user: {
                    uid: "u1",
                    email: null,
                    displayName: null,
                    photoURL: null,
                    roles: ["admin", "editor"]
                }
            };

            const context = buildConditionContext({
                path: "products",
                authController: mockAuthController as AuthController
            });

            expect(context.user.roles).toEqual(["admin", "editor"]);
        });
    });

    describe("buildConditionContext", () => {

        it("should build context with serialized dates", () => {
            const mockAuthController = {
                user: {
                    uid: "user123",
                    email: "test@example.com",
                    displayName: "Test User",
                    photoURL: null,
                    providerId: "google.com",
                    isAnonymous: false,
                    roles: [{ id: "admin",
name: "Admin" }, { id: "editor",
name: "Editor" }]
                }
            };

            const now = new Date();
            const context = buildConditionContext({
                propertyKey: "title",
                values: { title: "Hello",
createdAt: now },
                path: "products",
                entityId: "123",
                authController: mockAuthController as AuthController
            });

            expect(context.values.createdAt).toBe(now.getTime());
            expect(context.user.uid).toBe("user123");
            expect(context.user.roles).toEqual(["admin", "editor"]);
            expect(context.isNew).toBe(false);
            expect(context.entityId).toBe("123");
        });

        it("should mark isNew as true when no entityId", () => {
            const mockAuthController = {
                user: null
            };

            const context = buildConditionContext({
                path: "products",
                authController: mockAuthController as AuthController
            });

            expect(context.isNew).toBe(true);
            expect(context.entityId).toBeUndefined();
        });

        it("should handle user with Role object roles", () => {
            const mockAuthController = {
                user: {
                    uid: "user123",
                    email: "test@example.com",
                    displayName: "Test User",
                    photoURL: null,
                    roles: [{ id: "admin",
name: "Admin" }, { id: "editor",
name: "Editor" }]
                }
            };

            const context = buildConditionContext({
                path: "products",
                entityId: "123",
                authController: mockAuthController as AuthController
            });

            // Roles are mapped from Role.id
            expect(context.user.roles).toEqual(["admin", "editor"]);
        });

        it("should handle null user", () => {
            const mockAuthController = {
                user: null
            };

            const context = buildConditionContext({
                path: "products",
                authController: mockAuthController as AuthController
            });

            expect(context.user).toBeDefined();
            // uid defaults to empty string when user is null
            expect(context.user.uid).toBe("");
            expect(context.user.roles).toEqual([]);
        });
    });
});
