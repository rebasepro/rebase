import { buildStringProperty } from "../../src/builders/string_property_builder";
import type { ValuesCountEntry } from "../../src/types";
import type { StringProperty } from "@rebasepro/types";

function makeValuesResult(values: unknown[]): ValuesCountEntry {
    const valuesCount = new Map<unknown, number>();
    for (const v of values) {
        valuesCount.set(v, (valuesCount.get(v) || 0) + 1);
    }
    return { values,
valuesCount };
}

describe("buildStringProperty", () => {
    it("returns a basic string property with no values", () => {
        const result = buildStringProperty({
            name: "title",
            totalDocsCount: 10
        });
        expect(result.type).toBe("string");
        expect(result.name).toBe("title");
    });

    it("name defaults to empty string when not provided", () => {
        const result = buildStringProperty({
            name: "",
            totalDocsCount: 5
        });
        expect(result.name).toBe("");
    });

    it("detects URL values", () => {
        const urls = Array(10).fill("https://example.com/page");
        const result = buildStringProperty({
            name: "website",
            totalDocsCount: 10,
            valuesResult: makeValuesResult(urls)
        }) as StringProperty;
        // `url` is a fact about the data, not a rendering hint, so it sits on the
        // property itself beside `email` — and the OpenAPI contract is generated from it.
        expect(result.url).toBe(true);
    });

    it("does not flag as URL if less than 2/3 are URLs", () => {
        const mixed = [
            "https://example.com",
            "https://test.com",
            "not a url",
            "also not",
            "nope",
            "regular text",
            "more text",
            "another one",
            "one more",
            "last one"
        ];
        const result = buildStringProperty({
            name: "text",
            totalDocsCount: 10,
            valuesResult: makeValuesResult(mixed)
        });
        // On the property itself, not under `admin`: the builder never writes an
        // `admin` block, so an assertion on `admin?.url` held whatever the
        // threshold decided.
        expect((result as StringProperty).url).toBeUndefined();
    });

    it("detects email values", () => {
        const emails = Array(10).fill("user@example.com");
        const result = buildStringProperty({
            name: "email",
            totalDocsCount: 10,
            valuesResult: makeValuesResult(emails)
        }) as StringProperty;
        expect(result.email).toBe(true);
    });

    it("does not infer an enum from user-ID-looking values", () => {
        // 28-char no-space strings. Ten identical values would otherwise look like a
        // one-member enum, since the enum heuristic only counts distinct values.
        //
        // This used to assert `admin.readOnly`, which inference no longer sets: this is
        // a core package and `admin` is declared by @rebasepro/cms-types, so the field
        // does not exist here. Suppressing the enum is what the detection actually does,
        // and unlike a readOnly hint it affects the generated schema.
        const userIds = Array(10).fill("ABCDEFGHIJKLMNOPQRSTUVWXYZ12");
        const result = buildStringProperty({
            name: "userId",
            totalDocsCount: 10,
            valuesResult: makeValuesResult(userIds)
        }) as StringProperty;
        expect(result.enum).toBeUndefined();
        expect(result.type).toBe("string");
    });

    it("infers enum when few unique values", () => {
        // Only 2 unique values across 10 documents
        const values = [
            "active", "active", "active", "active", "active",
            "inactive", "inactive", "inactive", "inactive", "inactive"
        ];
        const result = buildStringProperty({
            name: "status",
            totalDocsCount: 10,
            valuesResult: makeValuesResult(values)
        }) as StringProperty;
        expect(result.enum).toBeDefined();
        expect(Array.isArray(result.enum)).toBe(true);
    });

    it("does not infer enum when many unique values", () => {
        // Many unique values
        const values = Array.from({ length: 10 }, (_, i) => `unique_value_${i}`);
        const result = buildStringProperty({
            name: "description",
            totalDocsCount: 10,
            valuesResult: makeValuesResult(values)
        }) as StringProperty;
        expect(result.enum).toBeUndefined();
    });

    it("detects image file extensions", () => {
        const images = Array(10).fill("uploads/photo.jpg");
        const result = buildStringProperty({
            name: "avatar",
            totalDocsCount: 10,
            valuesResult: makeValuesResult(images)
        }) as StringProperty;
        expect(result.storage).toBeDefined();
        expect(result.storage?.acceptedFiles).toContain("image/*");
    });

    it("detects audio file extensions", () => {
        const audio = Array(10).fill("audio/song.mp3");
        const result = buildStringProperty({
            name: "track",
            totalDocsCount: 10,
            valuesResult: makeValuesResult(audio)
        }) as StringProperty;
        expect(result.storage).toBeDefined();
        expect(result.storage?.acceptedFiles).toContain("audio/*");
    });

    it("detects video file extensions", () => {
        const video = Array(10).fill("videos/clip.mp4");
        const result = buildStringProperty({
            name: "video",
            totalDocsCount: 10,
            valuesResult: makeValuesResult(video)
        }) as StringProperty;
        expect(result.storage).toBeDefined();
        expect(result.storage?.acceptedFiles).toContain("video/*");
    });

    it("detects mixed media types", () => {
        const media = [
            "uploads/photo.jpg",
            "uploads/photo2.png",
            "uploads/photo3.webp",
            "uploads/song.mp3",
            "uploads/song2.ogg",
            "uploads/clip.mp4",
            "uploads/clip2.avi",
            "uploads/photo4.gif",
            "uploads/photo5.avif",
            "uploads/photo6.jpeg"
        ];
        const result = buildStringProperty({
            name: "media",
            totalDocsCount: 10,
            valuesResult: makeValuesResult(media)
        }) as StringProperty;
        expect(result.storage).toBeDefined();
        expect(result.storage?.acceptedFiles).toContain("image/*");
        expect(result.storage?.acceptedFiles).toContain("audio/*");
        expect(result.storage?.acceptedFiles).toContain("video/*");
    });

    it("returns plain string when no pattern detected", () => {
        const values = Array(10).fill("Just a regular text string here");
        const result = buildStringProperty({
            name: "description",
            totalDocsCount: 10,
            valuesResult: makeValuesResult(values)
        });
        expect(result.type).toBe("string");
        expect((result as StringProperty).email).toBeUndefined();
        expect((result as StringProperty).url).toBeUndefined();
        expect((result as StringProperty).storage).toBeUndefined();
    });
});
