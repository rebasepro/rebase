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
