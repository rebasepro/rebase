/**
 * The store behind every per-user table preference: a resized column, a
 * reordered one, the view mode a collection was left in.
 *
 * Two things went wrong here at once, and each hid the other.
 *
 * `<Rebase>` published whatever `userConfigPersistence` prop it was handed, and
 * the apps the CLI scaffolds hand it none — so the context was `undefined`, the
 * views' `onCollectionModified` calls were guarded away, and every preference
 * was written nowhere. Dragging a column wider worked until the next render, at
 * which point the table rebuilt its columns from the unchanged collection and
 * the column snapped back.
 *
 * Underneath that, the store kept its configs in a ref and returned a value
 * whose identity never changed. The views merge it into their collection during
 * render, so a write nothing could observe would have left the same symptom
 * even once the store was wired up.
 */
import React from "react";
import { act, render } from "@testing-library/react";
import { Rebase } from "../src/core/Rebase";
import { useUserConfigurationPersistence } from "../src/hooks/useUserConfigurationPersistence";
import type { UserConfigurationPersistence } from "@rebasepro/cms-types";
import type { RebaseClient, RebaseData } from "@rebasepro/types";

const mockAuthController: any = {
    user: { uid: "u1" },
    initialLoading: false,
    authLoading: false,
    loginSkipped: true,
    getAuthToken: jest.fn().mockResolvedValue("t")
};

const client = {
    data: { collection: () => ({}) } as unknown as RebaseData,
    auth: {},
    // Never settles: storage-source discovery is not what is under test here,
    // and an answer arriving mid-test is a state update outside `act`.
    fetchStorageSources: () => new Promise<never>(() => undefined)
} as unknown as RebaseClient;

/** Collects the controller as the views below `<Rebase>` see it, render by render. */
function Probe({ seen }: { seen: (UserConfigurationPersistence | undefined)[] }) {
    const persistence = useUserConfigurationPersistence();
    seen.push(persistence);
    return null;
}

function renderUnderRebase(seen: (UserConfigurationPersistence | undefined)[], persistence?: UserConfigurationPersistence) {
    return render(
        <Rebase authController={mockAuthController}
                client={client}
                storageSource={{} as any}
                userConfigPersistence={persistence}>
            <Probe seen={seen}/>
        </Rebase>
    );
}

describe("user configuration persistence", () => {

    beforeEach(() => {
        localStorage.clear();
    });

    it("is provided to the views even when the app passes none", () => {
        const seen: (UserConfigurationPersistence | undefined)[] = [];
        renderUnderRebase(seen);

        const persistence = seen.at(-1);
        expect(persistence).toBeDefined();

        act(() => persistence!.onCollectionModified("products", {
            properties: { name: { admin: { columnWidth: 337 } } }
        } as any));

        expect(JSON.parse(localStorage.getItem("collection_config::products")!))
            .toEqual({ properties: { name: { admin: { columnWidth: 337 } } } });
    });

    it("lets an app supply its own store instead", () => {
        const own = { getCollectionConfig: () => ({}), onCollectionModified: jest.fn() } as unknown as UserConfigurationPersistence;
        const seen: (UserConfigurationPersistence | undefined)[] = [];
        renderUnderRebase(seen, own);

        expect(seen.at(-1)).toBe(own);
    });

    it("merges a write into what is already stored", () => {
        const seen: (UserConfigurationPersistence | undefined)[] = [];
        renderUnderRebase(seen);
        const persistence = seen.at(-1)!;

        act(() => persistence.onCollectionModified("products", { defaultViewMode: "table" } as any));
        // A partial, as the type says. The view mode is nobody's business here
        // and must survive: writing the partial and merging afterwards read
        // back the value it had just overwritten, and lost it.
        act(() => persistence.onCollectionModified("products", {
            properties: { name: { admin: { columnWidth: 337 } } }
        } as any));

        expect(JSON.parse(localStorage.getItem("collection_config::products")!)).toEqual({
            defaultViewMode: "table",
            properties: { name: { admin: { columnWidth: 337 } } }
        });
        expect(persistence.getCollectionConfig("products")).toEqual({
            defaultViewMode: "table",
            properties: { name: { admin: { columnWidth: 337 } } }
        });
    });

    it("hands the views a new controller after a write, so they re-read it", () => {
        const seen: (UserConfigurationPersistence | undefined)[] = [];
        renderUnderRebase(seen);

        // After mount, so the store's own start-up reads are not what moves it.
        const before = seen.at(-1)!;
        act(() => before.onCollectionModified("products", {
            properties: { name: { admin: { columnWidth: 337 } } }
        } as any));

        // The stored configs live in a ref, so identity is the only signal a
        // view merging them during render can act on.
        expect(seen.at(-1)).not.toBe(before);
    });
});
