/**
 * @jest-environment jsdom
 */
import {
    getThumbnailMeasure,
    getPreviewSizeFrom,
    SMALL_THUMBNAIL,
    MEDIUM_THUMBNAIL,
    LARGE_THUMBNAIL
} from "../../src/preview/util";

// ---------------------------------------------------------------------------
// getThumbnailMeasure
// ---------------------------------------------------------------------------
describe("getThumbnailMeasure", () => {
    it("returns SMALL_THUMBNAIL for 'small'", () => {
        expect(getThumbnailMeasure("small")).toBe(SMALL_THUMBNAIL);
    });

    it("returns MEDIUM_THUMBNAIL for 'medium'", () => {
        expect(getThumbnailMeasure("medium")).toBe(MEDIUM_THUMBNAIL);
    });

    it("returns LARGE_THUMBNAIL for 'large'", () => {
        expect(getThumbnailMeasure("large")).toBe(LARGE_THUMBNAIL);
    });

    it("throws for unknown size", () => {
        expect(() => getThumbnailMeasure("giant" as any)).toThrow("Thumbnail size not mapped");
    });
});

// ---------------------------------------------------------------------------
// getPreviewSizeFrom
// ---------------------------------------------------------------------------
describe("getPreviewSizeFrom", () => {
    it("maps 'xs' to 'small'", () => {
        expect(getPreviewSizeFrom("xs")).toBe("small");
    });

    it("maps 's' to 'small'", () => {
        expect(getPreviewSizeFrom("s")).toBe("small");
    });

    // Density pass (2026-09-08): xs..m are text rows and take small previews;
    // only l and xl make room for a thumbnail. See DESIGN.md "Table and list density".
    it("maps 'm' to 'small'", () => {
        expect(getPreviewSizeFrom("m")).toBe("small");
    });

    it("maps 'l' to 'medium'", () => {
        expect(getPreviewSizeFrom("l")).toBe("medium");
    });

    it("maps 'xl' to 'large'", () => {
        expect(getPreviewSizeFrom("xl")).toBe("large");
    });

    it("throws for unmapped size", () => {
        expect(() => getPreviewSizeFrom("xxl" as any)).toThrow("Missing mapping value");
    });
});

// ---------------------------------------------------------------------------
// Constant values
// ---------------------------------------------------------------------------
describe("thumbnail constants", () => {
    it("SMALL_THUMBNAIL should be 40", () => {
        expect(SMALL_THUMBNAIL).toBe(40);
    });

    it("MEDIUM_THUMBNAIL should be 100", () => {
        expect(MEDIUM_THUMBNAIL).toBe(100);
    });

    it("LARGE_THUMBNAIL should be 200", () => {
        expect(LARGE_THUMBNAIL).toBe(200);
    });
});
