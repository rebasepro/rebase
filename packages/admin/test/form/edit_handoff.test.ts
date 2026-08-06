/**
 * Changing a record's layout is not leaving the record.
 *
 * The split's "hide list", full screen's "show list" and the side panel's "open
 * full screen" all replace one mounted form with another showing the same
 * record. What the user has typed has to arrive with it — and it has to arrive
 * as an *edit*, not as the local-changes banner asking whether to apply changes
 * that were made a second earlier and never abandoned.
 */
import { mergeDeep } from "@rebasepro/utils";
import {
    extractTouchedValues,
    getEditHandoffValues,
    getUnappliedLocalChanges,
    removeEmptyContainers
} from "../../src/form/form_utils";

type Product = {
    name: string;
    price: number;
    published: boolean;
    dimensions: { width: number; height: number };
};

const stored: Partial<Product> = {
    name: "Wooden chair",
    price: 100,
    published: true,
    dimensions: {
        width: 40,
        height: 90
    }
};

/**
 * What the sending form has written to the local-changes backup by the time the
 * layout changes — {@link EntityFormBinding} stores the touched values on every
 * change, and that is the copy the receiving form finds.
 */
function backupFor(values: Partial<Product>, touched: Record<string, boolean>) {
    return removeEmptyContainers(extractTouchedValues(values, touched)) as Partial<Product>;
}

describe("what a layout change carries", () => {

    it("carries only the fields edited here", () => {
        const values = {
            ...stored,
            price: 120
        };
        const carried = getEditHandoffValues<Product>({
            status: "existing",
            dirty: true,
            values,
            touched: { price: true },
            storedValues: stored
        });
        expect(carried).toEqual({ price: 120 });
    });

    it("carries nothing from a record nobody edited", () => {
        // Otherwise the next layout opens dirty, announcing unsaved changes to
        // someone who had only looked at the record.
        const carried = getEditHandoffValues<Product>({
            status: "existing",
            dirty: false,
            values: stored,
            touched: {},
            storedValues: stored
        });
        expect(carried).toBeUndefined();
    });

    it("carries a new record whole", () => {
        const values = { name: "Draft" } as Partial<Product>;
        const carried = getEditHandoffValues<Product>({
            status: "new",
            dirty: true,
            values,
            touched: {}
        });
        expect(carried).toEqual({ name: "Draft" });
    });

    it("falls back to the stored record when a value was set without being touched", () => {
        // A plugin or a custom field writing through `setFieldValue`: dirty, with
        // nothing marked touched. Dropping it would hand over a form that opens
        // clean over a live edit.
        const carried = getEditHandoffValues<Product>({
            status: "existing",
            dirty: true,
            values: {
                ...stored,
                published: false
            },
            touched: {},
            storedValues: stored
        });
        expect(carried).toEqual({ published: false });
    });

    it("carries an edit nested in a map", () => {
        const values = {
            ...stored,
            dimensions: {
                width: 40,
                height: 120
            }
        };
        const carried = getEditHandoffValues<Product>({
            status: "existing",
            dirty: true,
            values,
            touched: { "dimensions.height": true },
            storedValues: stored
        });
        expect(carried).toEqual({ dimensions: { height: 120 } });
    });
});

describe("the local-changes banner across a layout change", () => {

    it("stays away when the edit was carried over", () => {
        const values = {
            ...stored,
            price: 120
        };
        const touched = { price: true };

        const carried = getEditHandoffValues<Product>({
            status: "existing",
            dirty: true,
            values,
            touched,
            storedValues: stored
        });

        // The receiving form: the stored record, plus the edit handed to it.
        const openingValues = mergeDeep(stored, carried!);
        expect(openingValues.price).toBe(120);

        expect(getUnappliedLocalChanges(backupFor(values, touched), openingValues)).toBeUndefined();
    });

    it("stays away when a nested edit was carried over", () => {
        const values = {
            ...stored,
            dimensions: {
                width: 40,
                height: 120
            }
        };
        const touched = { "dimensions.height": true };

        const carried = getEditHandoffValues<Product>({
            status: "existing",
            dirty: true,
            values,
            touched,
            storedValues: stored
        });
        const openingValues = mergeDeep(stored, carried!);
        expect(openingValues.dimensions).toEqual({
            width: 40,
            height: 120
        });

        expect(getUnappliedLocalChanges(backupFor(values, touched), openingValues)).toBeUndefined();
    });

    it("still appears for a draft the form is not showing", () => {
        // The case the banner is actually for: a draft left behind by a closed
        // tab, with no handoff to account for it.
        const backup = backupFor({
            ...stored,
            price: 120
        }, { price: true });

        expect(getUnappliedLocalChanges(backup, stored)).toEqual(
            expect.objectContaining({ price: 120 })
        );
    });
});
