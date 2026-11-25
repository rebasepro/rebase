/**
 * A short string that is the same for two values with the same content and,
 * in practice, different for two that differ — what `getHashValue` keys array
 * items with.
 *
 * It was `object-hash`: SHA-1 over a canonical serialisation, 33 kB of
 * CommonJS that a bundler cannot tree-shake, so it rode in the eager chunk of
 * every admin (`objects.ts`, which imported it, is imported everywhere for
 * `getIn` and friends) to compute React keys for one component. A key needs
 * stability and few collisions, not a cryptographic digest.
 *
 * The serialisation is canonical: object keys sorted, Maps and Sets by their
 * entries in order, Dates by their time, a class instance prefixed with its
 * constructor's name, a cycle as a back-reference. Functions and symbols are
 * skipped, as `object-hash`'s `ignoreUnknown` did. The digest is cyrb53, twice
 * with different seeds: 106 bits, hex.
 */
export function stableHash(value: unknown): string {
    const text = serialize(value, []);
    return cyrb53(text, 0x9e3779b1).toString(16).padStart(14, "0") + cyrb53(text, 0x85ebca77).toString(16).padStart(14, "0");
}

function serialize(value: unknown, stack: object[]): string {
    if (typeof value === "string") return JSON.stringify(value);
    if (typeof value === "number") return `n${value}`;
    if (typeof value === "bigint") return `b${value}`;
    if (typeof value === "boolean") return value ? "t" : "f";
    if (value === undefined) return "u";
    if (value === null) return "z";
    if (typeof value !== "object") return ""; // a function or a symbol
    const cycle = stack.indexOf(value);
    if (cycle >= 0) return `^${stack.length - cycle}`;
    stack.push(value);
    try {
        if (value instanceof Date) return `d${value.getTime()}`;
        if (Array.isArray(value)) return `[${value.map(item => serialize(item, stack)).join(",")}]`;
        if (value instanceof Map) return `M{${Array.from(value, ([k, v]) => `${serialize(k, stack)}:${serialize(v, stack)}`).join(",")}}`;
        if (value instanceof Set) return `S[${Array.from(value, item => serialize(item, stack)).join(",")}]`;
        const proto: unknown = Object.getPrototypeOf(value);
        const name = proto === Object.prototype || proto === null
            ? ""
            : (typeof proto === "object" && "constructor" in proto && typeof proto.constructor === "function" ? proto.constructor.name : "");
        const entries = Object.keys(value).sort().map(key => {
            const serialized = serialize((value as Record<string, unknown>)[key], stack);
            return serialized === "" ? "" : `${JSON.stringify(key)}:${serialized}`;
        }).filter(Boolean);
        return `${name}{${entries.join(",")}}`;
    } finally {
        stack.pop();
    }
}

/** cyrb53 by bryc (public domain): a fast 53-bit string hash with good dispersion. */
function cyrb53(text: string, seed: number): number {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < text.length; i++) {
        const ch = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
