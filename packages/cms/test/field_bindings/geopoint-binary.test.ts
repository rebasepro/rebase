import { readCoordinates } from "../../src/form/field_bindings/GeopointFieldBinding";
import { BASE64, decodedBytes, humanSize } from "../../src/form/field_bindings/BinaryFieldBinding";

describe("reading a geopoint value", () => {
    it("reads a GeoPoint instance", () => {
        class GeoPoint {
            constructor(readonly latitude: number, readonly longitude: number) {}
        }
        expect(readCoordinates(new GeoPoint(41.3874, 2.1686)))
            .toEqual({ latitude: 41.3874, longitude: 2.1686 });
    });

    it("reads the plain object it becomes after JSON", () => {
        expect(readCoordinates(JSON.parse('{"latitude":41.3874,"longitude":2.1686}')))
            .toEqual({ latitude: 41.3874, longitude: 2.1686 });
    });

    it("reads the PostGIS {x, y} shape, with x as longitude", () => {
        // Getting this backwards puts Barcelona in the Indian Ocean.
        expect(readCoordinates({ x: 2.1686, y: 41.3874 }))
            .toEqual({ latitude: 41.3874, longitude: 2.1686 });
    });

    it("treats 0,0 as a real location, not as empty", () => {
        expect(readCoordinates({ latitude: 0, longitude: 0 }))
            .toEqual({ latitude: 0, longitude: 0 });
    });

    it("returns null for anything that is not a pair of coordinates", () => {
        expect(readCoordinates(null)).toBeNull();
        expect(readCoordinates(undefined)).toBeNull();
        expect(readCoordinates("41.3874, 2.1686")).toBeNull();
        expect(readCoordinates({ latitude: 41.3874 })).toBeNull();
        expect(readCoordinates({ latitude: "41.3874", longitude: "2.1686" })).toBeNull();
    });
});

describe("binary values", () => {
    it("accepts base64, with and without padding", () => {
        for (const ok of ["", "aGVsbG8=", "aGVsbG9x", "iVBORw0KGgo=", "YQ=="]) {
            expect(BASE64.test(ok)).toBe(true);
        }
    });

    it("rejects what is not base64", () => {
        for (const bad of ["hello world", "not!base64", "aGVsbG8=extra", "a="]) {
            expect(BASE64.test(bad)).toBe(false);
        }
    });

    it("counts decoded bytes without decoding", () => {
        expect(decodedBytes("")).toBe(0);
        expect(decodedBytes("YQ==")).toBe(1);        // "a"
        expect(decodedBytes("YWI=")).toBe(2);        // "ab"
        expect(decodedBytes("YWJj")).toBe(3);        // "abc"
        expect(decodedBytes("aGVsbG8=")).toBe(5);    // "hello"
    });

    it("agrees with an actual decode", () => {
        const source = "the quick brown fox";
        const encoded = Buffer.from(source).toString("base64");
        expect(decodedBytes(encoded)).toBe(Buffer.byteLength(source));
    });

    it("ignores whitespace, which pasted base64 is full of", () => {
        expect(decodedBytes("aGVs\nbG8=")).toBe(5);
    });

    it("reports a size a person can read", () => {
        expect(humanSize(512)).toBe("512 B");
        expect(humanSize(2048)).toBe("2.0 KB");
        expect(humanSize(5 * 1024 * 1024)).toBe("5.0 MB");
    });
});
