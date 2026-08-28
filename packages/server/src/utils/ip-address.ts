/**
 * `net.isIP`, without `node:net`.
 *
 * The SSRF guard in `services/outbound-url-guard.ts` needs to know whether a
 * host is already a literal address before it decides whether to resolve it.
 * That is pure string parsing — it opens no socket and asks nothing of the
 * platform — but importing it from `node:net` pinned the guard to a Node
 * process anyway. The guard's only other host dependency, the resolver, is
 * already injectable, so this is what stood between it and running anywhere.
 *
 * That matters more here than the line count suggests. On a host with no
 * `dns.lookup` the guard has to be given a resolver (DNS-over-HTTPS, or the
 * platform's own), and a module that cannot be *imported* there cannot be
 * given anything. The alternative — an isolate deployment quietly running
 * without the guard — is how a webhook destination becomes a way to read the
 * metadata endpoint.
 *
 * The grammar is Node's own, transcribed from `lib/internal/net.js`, and
 * `test/property/ip-address.property.test.ts` holds it to that by comparing against
 * `net.isIP` over generated addresses. Transcribing a validator by eye and
 * declaring it equivalent is not a thing to do to a security boundary; being
 * able to *check* the claim on every run is what makes it acceptable.
 *
 * @module
 */

const IPV4_SEGMENT = "(?:[0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5])";
const IPV4 = `(?:${IPV4_SEGMENT}\\.){3}${IPV4_SEGMENT}`;
const IPV4_RE = new RegExp(`^${IPV4}$`);

const IPV6_SEGMENT = "(?:[0-9a-fA-F]{1,4})";
/**
 * One alternative per position the `::` elision can occupy, which is why this
 * is nine branches rather than something shorter and wrong: a compact pattern
 * that admits two elisions, or a trailing dotted quad in the wrong place,
 * accepts strings the resolver would reject and the guard would then judge on
 * bytes it invented.
 */
const IPV6 =
    "(?:" +
    `(?:${IPV6_SEGMENT}:){7}(?:${IPV6_SEGMENT}|:)|` +
    `(?:${IPV6_SEGMENT}:){6}(?:${IPV4}|:${IPV6_SEGMENT}|:)|` +
    `(?:${IPV6_SEGMENT}:){5}(?::${IPV4}|(?::${IPV6_SEGMENT}){1,2}|:)|` +
    `(?:${IPV6_SEGMENT}:){4}(?:(?::${IPV6_SEGMENT}){0,1}:${IPV4}|(?::${IPV6_SEGMENT}){1,3}|:)|` +
    `(?:${IPV6_SEGMENT}:){3}(?:(?::${IPV6_SEGMENT}){0,2}:${IPV4}|(?::${IPV6_SEGMENT}){1,4}|:)|` +
    `(?:${IPV6_SEGMENT}:){2}(?:(?::${IPV6_SEGMENT}){0,3}:${IPV4}|(?::${IPV6_SEGMENT}){1,5}|:)|` +
    `(?:${IPV6_SEGMENT}:){1}(?:(?::${IPV6_SEGMENT}){0,4}:${IPV4}|(?::${IPV6_SEGMENT}){1,6}|:)|` +
    `(?::(?:(?::${IPV6_SEGMENT}){0,5}:${IPV4}|(?::${IPV6_SEGMENT}){1,7}|:))` +
    ")(?:%[0-9a-zA-Z-.:]{1,})?";
const IPV6_RE = new RegExp(`^${IPV6}$`);

/**
 * `4`, `6`, or `0` for anything that is not an IP address — the same three
 * answers, for the same inputs, as `net.isIP`.
 */
export function ipVersion(address: string): 0 | 4 | 6 {
    if (IPV4_RE.test(address)) return 4;
    if (IPV6_RE.test(address)) return 6;
    return 0;
}
