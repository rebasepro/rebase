import { hashPassword, verifyPassword } from "../src/auth/password";

/**
 * Scrypt parameters are a stored-data contract, not a tuning knob.
 *
 * `SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 }` was declared with a comment
 * calling it "recommended values for 2024+" and passed to neither `scrypt`
 * call. That was harmless only by coincidence — they are also Node's defaults —
 * so raising any of them would have read as strengthening the hash while
 * changing nothing at all.
 *
 * Now that they are passed, the opposite risk is live: changing them silently
 * invalidates every password already stored, and the symptom is every existing
 * user being unable to log in with a correct password. The hash below was
 * produced by Node's defaults, which is what every hash in every existing
 * database was produced by. It must keep verifying.
 */
const LEGACY_HASH =
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:" +
    "d160f99b282ac34c2a373ab5df4f6abe20ff50509266b861a32c074d920ef4b1" +
    "fdac3b61c17c8686fd75dc4eeb683361fae9c1bd8019fb526c33ce7f3098e75c";

describe("password hashing", () => {
    it("still verifies a hash written before the parameters were passed explicitly", async () => {
        expect(await verifyPassword("CorrectHorse1", LEGACY_HASH)).toBe(true);
    });

    it("rejects the wrong password against that same hash", async () => {
        expect(await verifyPassword("CorrectHorse2", LEGACY_HASH)).toBe(false);
    });

    it("round-trips a freshly written hash", async () => {
        const hash = await hashPassword("CorrectHorse1");

        expect(hash).not.toBe(LEGACY_HASH);          // fresh salt
        expect(await verifyPassword("CorrectHorse1", hash)).toBe(true);
        expect(await verifyPassword("wrong", hash)).toBe(false);
    });

    it("refuses a malformed stored hash rather than throwing", async () => {
        expect(await verifyPassword("x", "not-a-hash")).toBe(false);
        expect(await verifyPassword("x", "")).toBe(false);
    });
});
