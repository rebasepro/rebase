import { col, defineTable, describeJsonShape, isJsonField, isRelationDef, json, rel } from "../../src/schema";

/**
 * The runtime behaviour of the `json.*` shape builders and the `rel.*`
 * relation builders.
 */

const users = defineTable("users", { columns: { id: col.uuid().primaryKey() }, rls: "admin-only" });

describe("json.* — shapes", () => {
    it("records each leaf kind", () => {
        expect(json.string().shape).toEqual({ kind: "string" });
        expect(json.number().shape).toEqual({ kind: "number" });
        expect(json.boolean().shape).toEqual({ kind: "boolean" });
        expect(json.date().shape).toEqual({ kind: "date" });
        expect(json.geopoint().shape).toEqual({ kind: "geopoint" });
        expect(json.unknown().shape).toEqual({ kind: "unknown" });
        expect(json.storage({ path: "files/", maxBytes: "2KB" }).shape).toEqual({ kind: "string", storage: { path: "files/", maxBytes: 2048 } });
    });

    it("records objects, arrays and typed blocks", () => {
        expect(json.object({ a: json.string(), b: json.number().required() }).shape).toEqual({
            kind: "object", fields: { a: { kind: "string" }, b: { kind: "number", required: true } }
        });
        expect(json.object({}, { additional: true }).shape).toEqual({ kind: "object", fields: {}, additional: true });
        expect(json.array(json.boolean()).shape).toEqual({ kind: "array", of: { kind: "boolean" } });
        expect(json.oneOf({ text: json.string(), image: json.storage({ path: "i/" }) }).shape).toEqual({
            kind: "oneOf", typeField: "type", valueField: "value",
            variants: { text: { kind: "string" }, image: { kind: "string", storage: { path: "i/" } } }
        });
        expect(json.oneOf({ n: json.number() }, { typeField: "t", valueField: "v" }).shape).toMatchObject({ typeField: "t", valueField: "v" });
    });

    it("records every modifier", () => {
        expect(json.string().required().default("x").describe("d").validate({ max: 3, matches: /a/m }).oneOf(["x", "y"]).shape).toEqual({
            kind: "string", required: true, default: "x", description: "d", validate: { max: 3, matches: "a", matchesFlags: "m" }, oneOf: ["x", "y"]
        });
        expect(json.date().onCreateNow().shape).toEqual({ kind: "date", stamp: "create" });
        expect(json.date().onUpdateNow().shape).toEqual({ kind: "date", stamp: "update" });
        // A string field stamps the caller's id instead.
        expect(json.string().onCreateUser().shape).toEqual({ kind: "string", stamp: "createUser" });
        expect(json.string().required().onUpdateUser().shape).toEqual({ kind: "string", required: true, stamp: "updateUser" });
        expect(json.array(json.string()).validate({ minItems: 1 }).shape).toMatchObject({ validate: { minItems: 1 } });
        const beforeSave = ({ value }: { value: string }) => value;
        expect(json.string().transform({ beforeSave }).shape.transform?.beforeSave).toBe(beforeSave);
    });

    it("is immutable", () => {
        const plain = json.string();
        const required = plain.required();
        expect(plain.shape).toEqual({ kind: "string" });
        expect(required).not.toBe(plain);
    });

    it("strips hooks for the wire, at every depth", () => {
        const hook = { afterRead: ({ value }: { value: string }) => value };
        const shape = json.object({
            title: json.string().transform(hook),
            blocks: json.array(json.oneOf({ text: json.string().transform(hook) }).transform({}))
        }).transform({}).shape;
        expect(describeJsonShape(shape)).toEqual({
            kind: "object",
            fields: {
                title: { kind: "string" },
                blocks: { kind: "array", of: { kind: "oneOf", typeField: "type", valueField: "value", variants: { text: { kind: "string" } } } }
            }
        });
        expect(JSON.stringify(describeJsonShape(shape))).not.toContain("transform");
    });

    it("recognises a field builder by its brand", () => {
        expect(isJsonField(json.string())).toBe(true);
        expect(isJsonField({ brand: "rebase.json-field", shape: { kind: "string" } })).toBe(true);
        expect(isJsonField({ shape: {} })).toBe(false);
        expect(isJsonField(undefined)).toBe(false);
    });
});

describe("rel.* — relations", () => {
    it("records each kind with its options and the target thunk", () => {
        const target = () => users;
        expect(rel.belongsTo(target)).toEqual({ brand: "rebase.relation", kind: "belongsTo", target });
        expect(rel.belongsTo(target, { localKey: "author_id", notNull: true, unique: true, onDelete: "restrict", onUpdate: "cascade", index: false, constraint: false }))
            .toEqual({ brand: "rebase.relation", kind: "belongsTo", target, localKey: "author_id", notNull: true, unique: true, onDelete: "restrict", onUpdate: "cascade", index: false, constraint: false });
        expect(rel.hasOne(target, { foreignKey: "user_id", sourceKey: "auth_id" })).toEqual({ brand: "rebase.relation", kind: "hasOne", target, foreignKey: "user_id", sourceKey: "auth_id" });
        expect(rel.hasMany(target, { orderBy: ["id", "desc"] })).toEqual({ brand: "rebase.relation", kind: "hasMany", target, orderBy: ["id", "desc"] });
        const pivot = { rank: col.integer() };
        expect(rel.manyToMany(target, { through: "j", sourceKey: "a", targetKey: "b", pivot, onDelete: "cascade" }))
            .toEqual({ brand: "rebase.relation", kind: "manyToMany", target, through: "j", sourceKey: "a", targetKey: "b", pivot, onDelete: "cascade" });
        const steps = [{ table: "users", on: { from: "user_id", to: "id" } }];
        expect(rel.via(target, { steps, cardinality: "one" })).toEqual({ brand: "rebase.relation", kind: "via", target, steps, cardinality: "one" });
    });

    it("does not call the target thunk when the relation is declared", () => {
        const thunk = jest.fn(() => users);
        rel.belongsTo(thunk);
        rel.manyToMany(thunk);
        expect(thunk).not.toHaveBeenCalled();
    });

    it("refuses a via with no steps", () => {
        expect(() => rel.via(() => users, { steps: [] })).toThrow("`rel.via(target, { steps })` needs at least one join step.");
        expect(() => rel.via(() => users, JSON.parse("{}"))).toThrow(/at least one join step/);
    });

    it("recognises a relation by its brand", () => {
        expect(isRelationDef(rel.hasMany(() => users))).toBe(true);
        expect(isRelationDef({ brand: "rebase.relation", kind: "hasMany" })).toBe(true);
        expect(isRelationDef({ kind: "hasMany" })).toBe(false);
        expect(isRelationDef(null)).toBe(false);
    });
});
