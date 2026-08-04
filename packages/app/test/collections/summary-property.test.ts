import type { Property } from "@rebasepro/types";
import {
    SUMMARY_RANK,
    canSummariseProperty,
    isLongTextProperty,
    isStorageProperty,
    rankSummaryProperty
} from "../../src/collections/summary-property";

const property = (value: Record<string, unknown>) => value as unknown as Property;

describe("rankSummaryProperty", () => {

    it("ranks short free text as a value that fits whole", () => {
        expect(rankSummaryProperty(property({ type: "string", name: "Name" })))
            .toBe(SUMMARY_RANK.DIRECT);
    });

    it("ranks numbers, dates, booleans and enums as values that fit whole", () => {
        expect(rankSummaryProperty(property({ type: "number", name: "Count" }))).toBe(SUMMARY_RANK.DIRECT);
        expect(rankSummaryProperty(property({ type: "date", name: "Created" }))).toBe(SUMMARY_RANK.DIRECT);
        expect(rankSummaryProperty(property({ type: "boolean", name: "Active" }))).toBe(SUMMARY_RANK.DIRECT);
        expect(rankSummaryProperty(property({ type: "string", name: "Status", enum: [] }))).toBe(SUMMARY_RANK.DIRECT);
    });

    it("demotes Markdown and multiline text to an excerpt", () => {
        expect(rankSummaryProperty(property({ type: "string", name: "Bio", admin: { markdown: true } })))
            .toBe(SUMMARY_RANK.EXCERPT);
        expect(rankSummaryProperty(property({ type: "string", name: "Notes", admin: { multiline: true } })))
            .toBe(SUMMARY_RANK.EXCERPT);
    });

    it("rules out maps: a key/value table has no first line", () => {
        expect(rankSummaryProperty(property({ type: "map", name: "Address", properties: {} })))
            .toBe(SUMMARY_RANK.UNUSABLE);
        // No declared properties either — that renders as a raw key/value dump.
        expect(rankSummaryProperty(property({ type: "map", name: "Metadata" })))
            .toBe(SUMMARY_RANK.UNUSABLE);
    });

    it("rules out arrays whose entries are themselves blocks", () => {
        expect(rankSummaryProperty(property({
            type: "array",
            name: "Addresses",
            of: { type: "map", name: "Address", properties: {} }
        }))).toBe(SUMMARY_RANK.UNUSABLE);

        // A tuple is several properties side by side.
        expect(rankSummaryProperty(property({
            type: "array",
            name: "Pair",
            of: [{ type: "string", name: "A" }, { type: "string", name: "B" }]
        }))).toBe(SUMMARY_RANK.UNUSABLE);

        // A stack of excerpts is worse than one excerpt.
        expect(rankSummaryProperty(property({
            type: "array",
            name: "Chapters",
            of: { type: "string", name: "Chapter", admin: { markdown: true } }
        }))).toBe(SUMMARY_RANK.UNUSABLE);
    });

    it("keeps arrays of short values: they render as a run of chips", () => {
        expect(rankSummaryProperty(property({
            type: "array",
            name: "Tags",
            of: { type: "string", name: "Tag" }
        }))).toBe(SUMMARY_RANK.DIRECT);
    });

    it("rules out storage properties, which belong to the image slot", () => {
        expect(rankSummaryProperty(property({
            type: "string",
            name: "Picture",
            storage: { storagePath: "pictures/" }
        }))).toBe(SUMMARY_RANK.UNUSABLE);
        expect(rankSummaryProperty(property({
            type: "string",
            name: "Cover",
            admin: { urlPreview: "image" }
        }))).toBe(SUMMARY_RANK.UNUSABLE);
    });

    it("treats a single relation as a value: it collapses to one linked line", () => {
        expect(rankSummaryProperty(property({ type: "relation", name: "Author" })))
            .toBe(SUMMARY_RANK.DIRECT);
        expect(rankSummaryProperty(property({ type: "reference", name: "Author", path: "authors" })))
            .toBe(SUMMARY_RANK.DIRECT);
    });

    it("reports an absent property as unusable rather than throwing", () => {
        expect(rankSummaryProperty(undefined)).toBe(SUMMARY_RANK.UNUSABLE);
    });
});

describe("canSummariseProperty", () => {
    it("accepts anything with a one-line form, excerpt included", () => {
        expect(canSummariseProperty(property({ type: "string", name: "Name" }))).toBe(true);
        expect(canSummariseProperty(property({ type: "string", name: "Bio", admin: { markdown: true } }))).toBe(true);
        expect(canSummariseProperty(property({ type: "map", name: "Address" }))).toBe(false);
    });
});

describe("isLongTextProperty / isStorageProperty", () => {
    it("recognises long text only on strings", () => {
        expect(isLongTextProperty(property({ type: "string", admin: { markdown: true } }))).toBe(true);
        expect(isLongTextProperty(property({ type: "number", admin: { multiline: true } }))).toBe(false);
        expect(isLongTextProperty(undefined)).toBe(false);
    });

    it("recognises storage on both a string and an array of them", () => {
        expect(isStorageProperty(property({ type: "string", storage: {} }))).toBe(true);
        expect(isStorageProperty(property({
            type: "array",
            of: { type: "string", storage: {} }
        }))).toBe(true);
        expect(isStorageProperty(property({ type: "string" }))).toBe(false);
    });
});
