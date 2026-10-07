import type { LookupFunction } from "node:net";
import { ipVersion } from "../utils/ip-address";

/**
 * Refusal to send a request to a destination the guard does not allow.
 *
 * Distinct from a network error on purpose: a blocked destination is
 * *terminal* — retrying it re-runs the same refusal — while an `ENOTFOUND`
 * or a refused connection is worth another attempt.
 */
export class BlockedUrlError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BlockedUrlError";
    }
}

export interface OutboundUrlGuardOptions {
    /**
     * Send to destinations that resolve to loopback, link-local, private or
     * otherwise non-public addresses. Off by default, and turning it on
     * re-opens SSRF: any caller who can choose the URL can then reach the
     * pod's own metadata endpoint, the cluster API server and the database.
     * Only for a genuinely local receiver (a sidecar, a dev tunnel).
     */
    allowPrivateNetworks?: boolean;
    /**
     * Hostname resolver. Defaults to `dns.lookup(host, { all: true })`.
     * Injected by tests so a unit suite never touches a resolver.
     */
    lookup?: (hostname: string) => Promise<string[]>;
}

/** Names that mean "this machine" or "this network" before DNS is even asked. */
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

/**
 * The resolver when the caller supplies none: Node's.
 *
 * Loaded on use rather than imported at the top, which is what keeps this
 * module — the check standing between a stored URL and the pod's own metadata
 * endpoint — loadable on a runtime that has no `node:dns`. There the caller
 * passes {@link OutboundUrlGuardOptions.lookup} instead, pointing at whatever
 * the host resolves names with.
 *
 * A host with neither fails **closed**, and says which of the two it is
 * missing: the alternative to resolving a name is not "allow it", it is "do
 * not send".
 */
async function defaultLookup(hostname: string): Promise<string[]> {
    let dns: typeof import("node:dns/promises");
    try {
        dns = await import("node:dns/promises");
    } catch {
        throw new BlockedUrlError(
            `Cannot check where "${hostname}" points: this runtime has no \`node:dns\`, and no ` +
            "`lookup` was supplied to the outbound URL guard. Pass one — the guard cannot be " +
            "skipped, because skipping it is what makes a stored URL a way to reach the " +
            "internal network."
        );
    }
    const entries = await dns.lookup(hostname, { all: true, verbatim: true });
    return entries.map(e => e.address);
}

/**
 * Parse an IPv6 literal into its 16 bytes. Returns `null` for anything that is
 * not one — the caller has already established the string *is* an IPv6 address
 * via `isIP`, so `null` here means "shape we do not model", which is treated as
 * blocked rather than allowed.
 */
function parseIpv6(address: string): number[] | null {
    let text = address;
    // A zone id (`fe80::1%eth0`) is scope, not address.
    const zone = text.indexOf("%");
    if (zone !== -1) text = text.slice(0, zone);

    // A trailing dotted quad (`::ffff:127.0.0.1`) is the last four bytes.
    let tail: number[] = [];
    const lastColon = text.lastIndexOf(":");
    const maybeV4 = text.slice(lastColon + 1);
    if (maybeV4.includes(".")) {
        if (ipVersion(maybeV4) !== 4) return null;
        tail = maybeV4.split(".").map(Number);
        text = text.slice(0, lastColon);
        // `::1.2.3.4` leaves a lone ":" — the compression marker, halved.
        if (text.endsWith(":")) text += ":";
    }

    const halves = text.split("::");
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(":") : [];
    const rest = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : [];

    const groups = 8 - tail.length / 2;
    const missing = groups - head.length - rest.length;
    if (halves.length === 1 ? missing !== 0 : missing < 0) return null;

    const all = [...head, ...new Array(halves.length === 2 ? missing : 0).fill("0"), ...rest];
    const bytes: number[] = [];
    for (const group of all) {
        const value = Number.parseInt(group, 16);
        if (!Number.isFinite(value) || value < 0 || value > 0xffff || !/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
        bytes.push((value >> 8) & 0xff, value & 0xff);
    }
    return [...bytes, ...tail];
}

/**
 * Why this IPv4 address must not be a webhook destination, or `null` if it is
 * an ordinary public address.
 */
function blockedIpv4Reason(bytes: number[]): string | null {
    const [a, b] = bytes;
    if (a === 0) return "\"this network\" (0.0.0.0/8)";
    if (a === 10) return "private (10.0.0.0/8)";
    if (a === 127) return "loopback (127.0.0.0/8)";
    if (a === 169 && b === 254) return "link-local (169.254.0.0/16) — the cloud metadata range";
    if (a === 172 && b >= 16 && b <= 31) return "private (172.16.0.0/12)";
    if (a === 192 && b === 168) return "private (192.168.0.0/16)";
    if (a === 100 && b >= 64 && b <= 127) return "carrier-grade NAT (100.64.0.0/10)";
    if (a === 192 && b === 0 && bytes[2] === 0) return "IETF protocol assignments (192.0.0.0/24)";
    if (a === 198 && (b === 18 || b === 19)) return "benchmarking (198.18.0.0/15)";
    if (a >= 224) return "multicast, reserved or broadcast (224.0.0.0/4 and above)";
    return null;
}

/**
 * Why this address must not be a webhook destination, or `null` if it is an
 * ordinary public address. Exported for tests and for anyone else adding an
 * outbound call whose destination comes from data.
 */
export function blockedAddressReason(address: string): string | null {
    const version = ipVersion(address);
    if (version === 4) return blockedIpv4Reason(address.split(".").map(Number));
    if (version !== 6) return `not an IP address: ${address}`;

    const bytes = parseIpv6(address);
    if (!bytes || bytes.length !== 16) return `unparseable IPv6 address: ${address}`;

    // IPv4-mapped (::ffff:0:0/96), IPv4-compatible (::/96) and NAT64
    // (64:ff9b::/96) all carry a v4 address in the low 32 bits. Judging the
    // wrapper instead of what it wraps is how 127.0.0.1 gets through.
    const low32 = bytes.slice(12);
    const isMapped = bytes.slice(0, 10).every(x => x === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
    const isCompat = bytes.slice(0, 12).every(x => x === 0) && !(low32[0] === 0 && low32[1] === 0);
    const isNat64 = bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b;
    if (isMapped || isCompat || isNat64) return blockedIpv4Reason(low32);
    // 6to4 (2002::/16) embeds the v4 address it tunnels to in bytes 2..5.
    if (bytes[0] === 0x20 && bytes[1] === 0x02) return blockedIpv4Reason(bytes.slice(2, 6));

    if (bytes.every(x => x === 0)) return "unspecified (::)";
    if (bytes.slice(0, 15).every(x => x === 0) && bytes[15] === 1) return "loopback (::1)";
    if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return "link-local (fe80::/10)";
    if ((bytes[0] & 0xfe) === 0xfc) return "unique local (fc00::/7)";
    if (bytes[0] === 0xff) return "multicast (ff00::/8)";
    return null;
}

/**
 * The checks that need no resolver, in order of cost: the URL parses, the
 * scheme is http(s), the host is not a name that means "this machine" or "this
 * network", and an address written into the URL is a public one. Returns the
 * URL and the host to resolve — `undefined` when the URL names an address,
 * which needs no resolving and has been judged here.
 */
function checkBeforeResolving(rawUrl: string, options: OutboundUrlGuardOptions): { url: URL; hostname?: string } {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new BlockedUrlError(`Invalid webhook URL: ${JSON.stringify(rawUrl)}`);
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new BlockedUrlError(`Webhook URL must be http(s), got "${url.protocol}" in ${url.href}`);
    }

    if (options.allowPrivateNetworks) return { url };

    // `URL` keeps IPv6 literals in brackets.
    const hostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
    const lowered = hostname.toLowerCase();
    if (lowered === "localhost" || BLOCKED_HOST_SUFFIXES.some(suffix => lowered.endsWith(suffix))) {
        throw new BlockedUrlError(`Webhook URL host "${hostname}" is an internal name`);
    }

    if (ipVersion(hostname)) {
        assertAllowedAddresses(hostname, [hostname]);
        return { url };
    }
    return { url, hostname };
}

/** Why an address may not be connected to, or `null`: {@link blockedAddressReason}. */
export type AddressJudge = (address: string) => string | null;

/** Every address `hostname` resolved to must be a public one — not the first, every one. */
function assertAllowedAddresses(hostname: string, addresses: readonly string[], judge: AddressJudge = blockedAddressReason): void {
    if (addresses.length === 0) {
        throw new BlockedUrlError(`Webhook URL host "${hostname}" resolved to no addresses`);
    }
    for (const address of addresses) {
        const reason = judge(address);
        if (reason) {
            throw new BlockedUrlError(
                `Webhook URL host "${hostname}" resolves to ${address}, which is ${reason}. ` +
                "Set allowPrivateNetworks to deliver to it anyway."
            );
        }
    }
}

/**
 * Resolve and validate a destination before anything connects to it.
 *
 * Three checks, in order, because each is cheaper than the next: the scheme,
 * the hostname, then every address the hostname resolves to. *Every* address —
 * a name that answers with one public and one private record is a rebinding
 * attempt, and taking the first record would let it through.
 *
 * Known limit: this is validate-then-fetch. Between the lookup here and the
 * connection the runtime makes there is a second resolution this code does not
 * see, so a TTL-0 name that flips between answers can still land on a blocked
 * address. On Node the webhook dispatcher does not use this: it checks the
 * address it connects to, through {@link guardedLookup}. This is the check for
 * a runtime whose `fetch` cannot be handed a resolver.
 *
 * @throws BlockedUrlError when the destination is not allowed. DNS failures
 * are rethrown as they are, so callers can tell "never send this" from
 * "could not send this right now".
 */
export async function assertAllowedOutboundUrl(
    rawUrl: string,
    options: OutboundUrlGuardOptions = {}
): Promise<URL> {
    const { url, hostname } = checkBeforeResolving(rawUrl, options);
    if (hostname !== undefined) {
        assertAllowedAddresses(hostname, await (options.lookup ?? defaultLookup)(hostname));
    }
    return url;
}

/**
 * Every check of {@link assertAllowedOutboundUrl} but the lookup, for a
 * connection that resolves the name through {@link guardedLookup}. The scheme,
 * the internal names and an address written into the URL are judged here —
 * a connection to a literal address asks no resolver, so nothing else would.
 *
 * Internal to the server: not exported from the package.
 */
export function assertAllowedBeforeConnecting(rawUrl: string, options: OutboundUrlGuardOptions = {}): URL {
    return checkBeforeResolving(rawUrl, options).url;
}

/**
 * A `dns.lookup` for an http(s) Agent that refuses to connect anywhere the
 * guard would not send: it resolves the name, judges *every* address it got,
 * and hands the connection only addresses it judged — so the address checked
 * is the address connected to. Validate-then-fetch resolves twice, and a
 * name whose TTL-0 record flips between the two lookups lands on whatever the
 * second one says.
 *
 * Called once per new connection, not per request: a keep-alive connection
 * is to an address already judged. Nothing is cached — an "allowed" verdict
 * that outlived its lookup would be the rebinding window again.
 *
 * Fails with {@link BlockedUrlError}, which the connection reports as its
 * error; a resolver failure is reported as itself.
 *
 * Internal to the server: not exported from the package. `judge` is for the
 * tests that need a receiver on loopback; nothing else passes one.
 */
export function guardedLookup(options: OutboundUrlGuardOptions = {}, judge: AddressJudge = blockedAddressReason): LookupFunction {
    const resolve = options.lookup ?? defaultLookup;
    return (hostname, lookupOptions, callback) => {
        resolve(hostname).then((addresses) => {
            if (!options.allowPrivateNetworks) assertAllowedAddresses(hostname, addresses, judge);
            const family = lookupOptions.family === "IPv4" ? 4 : lookupOptions.family === "IPv6" ? 6 : lookupOptions.family;
            const usable = addresses
                .map(address => ({ address, family: ipVersion(address) }))
                .filter(entry => entry.family !== 0 && (!family || entry.family === family));
            if (usable.length === 0) {
                const error: NodeJS.ErrnoException = new Error(`getaddrinfo ENOTFOUND ${hostname}`);
                error.code = "ENOTFOUND";
                callback(error, "", 0);
                return;
            }
            if (lookupOptions.all) callback(null, usable);
            else callback(null, usable[0].address, usable[0].family);
        }).catch((error: NodeJS.ErrnoException) => {
            callback(error, "", 0);
        });
    };
}
