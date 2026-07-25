import { isReadOnly, isHidden } from "../../src/collections/property_presentation";
import type { Property } from "@rebasepro/types";

describe("isReadOnly", () => {
    it("returns true for readOnly property", () => {
        expect(isReadOnly({ type: "string",
name: "Title",
ui: { readOnly: true } } as Property)).toBe(true);
    });

    it("returns true for date with autoValue", () => {
        expect(isReadOnly({ type: "date",
name: "Created",
autoValue: "on_create" } as Property)).toBe(true);
    });

    it("returns false for editable date", () => {
        expect(isReadOnly({ type: "date",
name: "Birthday" } as Property)).toBe(false);
    });

    it("returns true for reference without path and no Field", () => {
        expect(isReadOnly({ type: "reference",
name: "Ref" } as Property)).toBe(true);
    });

    it("returns false for reference with path", () => {
        expect(isReadOnly({ type: "reference",
name: "Ref",
path: "users" } as Property)).toBe(false);
    });

    it("returns false for normal string property", () => {
        expect(isReadOnly({ type: "string",
name: "Name" } as Property)).toBe(false);
    });
});

describe("isHidden", () => {
    it("returns true when disabled.hidden is true", () => {
        expect(isHidden({ type: "string",
name: "Secret",
ui: { disabled: { hidden: true,
clearOnDisabled: false } } } as Property)).toBe(true);
    });

    it("returns false when disabled is boolean true", () => {
        expect(isHidden({ type: "string",
name: "Title",
ui: { disabled: true } } as Property)).toBe(false);
    });

    it("returns false when disabled is undefined", () => {
        expect(isHidden({ type: "string",
name: "Title" } as Property)).toBe(false);
    });

    it("returns false when hidden is false", () => {
        expect(isHidden({ type: "string",
name: "Title",
ui: { disabled: { hidden: false,
clearOnDisabled: false } } } as Property)).toBe(false);
    });
});
