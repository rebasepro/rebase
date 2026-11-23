/**
 * Which parts of Rebase Cloud's offer are live, and where projects run.
 *
 * Kept apart from `cloud-offer.ts` (which reads the price list and the English
 * dictionary) so that a client-side island — the jurisdiction demo — can read
 * the flags without shipping either. Read `cloud-offer.ts` first: it explains
 * what each flag gates and how the two files are kept true.
 */
export type RegionId = "europe-west1" | "fsn1";

export const CLOUD_FLAGS = {
    /**
     * Strangers can sign up and pay on their own: the control plane runs with
     * REBASE_SELF_SERVE_SIGNUP on and the Cloud terms are published. Off, the
     * site keeps "private beta" and "Request access".
     */
    selfServe: false,
    /**
     * Where a new project is created. `fsn1` (Falkenstein, Hetzner) since the
     * November 2026 move: the control plane runs there, the tenants were moved
     * there (11-22/23) and its rates are the held card (saas
     * `rate-card.ts` HELD_PRICES, default project €24.28). `europe-west1`
     * (Belgium, Google Cloud) is still `sellable` in saas `substrate-rates.ts`
     * and is still saas's `DEFAULT_REGION`; switch back only if new projects
     * are sold there again.
     */
    region: "fsn1" as RegionId,
    /** A project can sleep when idle and is billed the sleeping rate (needs the runtime release and REBASE_SLEEP_BILLING). */
    sleep: false,
    /** File storage keeps a second copy in Nuremberg and recovers deleted files for 30 days (the storage broker). */
    fileSecondCopy: false
};

/**
 * Where a region is, who runs the machines, and the facts that change with it.
 * Customer words only: a place and a company, never the machinery.
 */
export const REGION_FACTS: Record<RegionId, {
    place: string;
    country: string;
    /** The company whose machines the projects run on: a sub-processor. */
    provider: string;
    /** The one fixed address outbound traffic leaves from, or null while none is promised. */
    outboundIp: string | null;
    /** Ports open for outbound mail. */
    mailPorts: string;
    /**
     * How far an app may use CPU beyond what it reserves, at no charge, or
     * null where no burst is promised. `times` × the reservation, at most
     * `capVcpu` per app.
     */
    cpuBurst: { times: number; capVcpu: number } | null;
}> = {
    "europe-west1": {
        place: "Belgium",
        country: "Belgium",
        provider: "Google Cloud",
        // docs/deployment/managed-runtime.md "Outbound traffic".
        outboundIp: "207.175.138.15",
        mailPorts: "465, 587 and 993",
        // GKE Autopilot: no burst rule (saas provider-profile.ts GKE_AUTOPILOT).
        cpuBurst: null
    },
    fsn1: {
        place: "Falkenstein, Germany",
        country: "Germany",
        provider: "Hetzner Online GmbH",
        // Not bought yet (saas docs/offer-proposal.md §5, rank 6). Set it here
        // when it exists, and in docs/deployment/managed-runtime.md.
        outboundIp: null,
        // Hetzner blocks 465 (saas docs/hetzner-fleet-readiness.md item 10).
        mailPorts: "587 and 993",
        // saas provider-profile.ts `fixedNodeBurst`: CPU limit 10x the request,
        // at most half a worker; tenant-topology.ts `burstLimitedResources`
        // floors that to 100m. A CPX32 worker gives pods 3.55 vCPU
        // (hetzner-fleet-cost.ts), so half is 1.775, floored to 1.7.
        cpuBurst: { times: 10, capVcpu: 1.7 }
    }
};

/** Where the second copy of files is kept, once the storage broker ships. */
export const FILE_SECOND_COPY_PLACE = "Nuremberg, Germany";

