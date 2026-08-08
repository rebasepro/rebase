import { assertAllowedOutboundUrl, blockedAddressReason, BlockedUrlError } from "../src/services/outbound-url-guard";

/**
 * The address classifier, on its own. The dispatcher suite proves the guard is
 * *called*; this one proves it is right — in particular for the IPv6 shapes
 * that carry a v4 address inside them, where judging the wrapper instead of
 * what it wraps is how 127.0.0.1 gets through.
 */
describe("blockedAddressReason", () => {
    it.each([
        ["127.0.0.1", "loopback"],
        ["127.255.255.254", "loopback"],
        ["10.1.2.3", "private"],
        ["172.16.0.1", "private"],
        ["172.31.255.255", "private"],
        ["192.168.0.1", "private"],
        ["169.254.169.254", "link-local"],
        ["0.0.0.0", "this network"],
        ["100.64.0.1", "carrier-grade NAT"],
        ["192.0.0.1", "IETF protocol assignments"],
        ["198.18.0.1", "benchmarking"],
        ["239.1.1.1", "multicast"],
        ["255.255.255.255", "multicast"],
        ["::1", "loopback"],
        ["::", "unspecified"],
        ["fe80::1", "link-local"],
        ["fe80::1%eth0", "link-local"],
        ["fd12:3456:789a::1", "unique local"],
        ["fc00::1", "unique local"],
        ["ff02::1", "multicast"],
        ["::ffff:127.0.0.1", "loopback"],
        ["::ffff:169.254.169.254", "link-local"],
        ["::ffff:7f00:1", "loopback"],
        ["::10.0.0.1", "private"],
        ["64:ff9b::127.0.0.1", "loopback"],
        ["2002:7f00:0001::", "loopback"],
        ["not-an-address", "not an IP address"]
    ])("blocks %s", (address, reason) => {
        expect(blockedAddressReason(address)).toContain(reason);
    });

    it.each([
        "93.184.216.34",
        "8.8.8.8",
        "172.32.0.1",
        "172.15.255.255",
        "100.128.0.1",
        "2606:2800:220:1:248:1893:25c8:1946",
        "::ffff:93.184.216.34",
        "2002:5db8:d822::"
    ])("allows the public address %s", (address) => {
        expect(blockedAddressReason(address)).toBeNull();
    });
});

describe("assertAllowedOutboundUrl", () => {
    const lookup = async () => ["93.184.216.34"];

    it("returns the parsed URL for a public https destination", async () => {
        const url = await assertAllowedOutboundUrl("https://example.com/hook?x=1", { lookup });
        expect(url.href).toBe("https://example.com/hook?x=1");
    });

    it("rejects a URL that does not parse", async () => {
        await expect(assertAllowedOutboundUrl("not a url", { lookup }))
            .rejects.toBeInstanceOf(BlockedUrlError);
    });

    it("checks every address a name resolves to, not the first", async () => {
        await expect(assertAllowedOutboundUrl("https://split.example.com/", {
            lookup: async () => ["93.184.216.34", "169.254.169.254"]
        })).rejects.toThrow(/link-local/);
    });

    it("rejects a name that resolves to nothing", async () => {
        await expect(assertAllowedOutboundUrl("https://empty.example.com/", { lookup: async () => [] }))
            .rejects.toThrow(/no addresses/);
    });

    it("propagates a DNS failure as itself, so the caller can still retry", async () => {
        // A resolver that is down is an outage, not a decision — telling the
        // two apart is what keeps a blocked destination from being retried and
        // a transient failure from being given up on.
        const failure = new Error("getaddrinfo EAI_AGAIN example.com");
        await expect(assertAllowedOutboundUrl("https://example.com/", { lookup: async () => { throw failure; } }))
            .rejects.toBe(failure);
    });

    it("skips the checks entirely when allowPrivateNetworks is set", async () => {
        const url = await assertAllowedOutboundUrl("http://127.0.0.1:9000/hook", { allowPrivateNetworks: true });
        expect(url.hostname).toBe("127.0.0.1");
    });
});
