import { isPublicStoragePath, PUBLIC_STORAGE_PREFIX } from "../src/controllers/storage";

describe("isPublicStoragePath", () => {
    it("treats keys under the public prefix as public", () => {
        expect(isPublicStoragePath("public/avatar.png")).toBe(true);
        expect(isPublicStoragePath(`${PUBLIC_STORAGE_PREFIX}logo.svg`)).toBe(true);
        expect(isPublicStoragePath("/public/leading-slash.png")).toBe(true);
        expect(isPublicStoragePath("local://public/x.png")).toBe(true);
        expect(isPublicStoragePath("s3://public/x.png")).toBe(true);
    });

    it("tolerates a single leading `default/` bucket segment", () => {
        expect(isPublicStoragePath("default/public/x.png")).toBe(true);
        expect(isPublicStoragePath("local://default/public/x.png")).toBe(true);
    });

    it("does NOT treat a private folder literally named `public` as public", () => {
        // Security: substring matching would wrongly expose these token-less.
        expect(isPublicStoragePath("reports/public/q3.pdf")).toBe(false);
        expect(isPublicStoragePath("media/public/x.png")).toBe(false);
        expect(isPublicStoragePath("a/b/public/c.png")).toBe(false);
    });

    it("never treats a traversal path as public (defense-in-depth)", () => {
        expect(isPublicStoragePath("public/../secret.png")).toBe(false);
        expect(isPublicStoragePath("default/public/../../etc/passwd")).toBe(false);
    });

    it("returns false for empty / non-public keys", () => {
        expect(isPublicStoragePath(null)).toBe(false);
        expect(isPublicStoragePath(undefined)).toBe(false);
        expect(isPublicStoragePath("")).toBe(false);
        expect(isPublicStoragePath("products/img.png")).toBe(false);
        expect(isPublicStoragePath("publicish/x.png")).toBe(false); // not the prefix folder
    });
});
