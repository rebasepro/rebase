import { LeaseStorage, withStorageLease } from "./offline-lease";

/** One `localStorage` shared by every "tab" in a test, as real tabs share one. */
function sharedStorage(): LeaseStorage & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
        map,
        getItem: (key) => map.get(key) ?? null,
        setItem: (key, value) => { map.set(key, value); },
        removeItem: (key) => { map.delete(key); }
    };
}

const fast = { settleMs: 5, pollMs: 5, ttlMs: 1_000 };

describe("withStorageLease", () => {
    it("never lets two holders run at once", async () => {
        const storage = sharedStorage();
        let running = 0;
        let overlapped = false;
        const work = async () => {
            running++;
            if (running > 1) overlapped = true;
            await new Promise((resolve) => setTimeout(resolve, 20));
            running--;
        };

        await Promise.all(["a", "b", "c"].map((tab) => withStorageLease(storage, "k", tab, work, fast)));

        expect(overlapped).toBe(false);
        expect(storage.map.has("k")).toBe(false);
    });

    it("waits for the holder, then runs", async () => {
        const storage = sharedStorage();
        const order: string[] = [];
        let releaseA!: () => void;
        const a = withStorageLease(storage, "k", "a", () => new Promise<void>((resolve) => {
            order.push("a start");
            releaseA = () => { order.push("a end"); resolve(); };
        }), fast);
        await new Promise((resolve) => setTimeout(resolve, 20));
        const b = withStorageLease(storage, "k", "b", async () => { order.push("b"); }, fast);
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(order).toEqual(["a start"]);
        releaseA();
        await Promise.all([a, b]);
        expect(order).toEqual(["a start", "a end", "b"]);
    });

    it("takes over a lease its holder left to expire", async () => {
        const storage = sharedStorage();
        storage.setItem("k", JSON.stringify({ holder: "dead tab", until: Date.now() - 1 }));
        await expect(withStorageLease(storage, "k", "b", async () => "ran", fast)).resolves.toBe("ran");
    });

    it("releases the lease when the work throws", async () => {
        const storage = sharedStorage();
        await expect(withStorageLease(storage, "k", "a", async () => { throw new Error("boom"); }, fast))
            .rejects.toThrow("boom");
        expect(storage.map.has("k")).toBe(false);
    });

    it("runs anyway when storage refuses writes", async () => {
        const storage: LeaseStorage = {
            getItem: () => null,
            setItem: () => { throw new Error("QuotaExceededError"); },
            removeItem: () => undefined
        };
        await expect(withStorageLease(storage, "k", "a", async () => "ran", fast)).resolves.toBe("ran");
    });

    it("ignores a record it cannot read", async () => {
        const storage = sharedStorage();
        storage.setItem("k", "not json");
        await expect(withStorageLease(storage, "k", "a", async () => "ran", fast)).resolves.toBe("ran");
    });
});
