/**
 * What each dial costs on its own — per millicore and per MiB a month for the
 * app and for the database, and per GiB of disk — read back out of the sizes
 * in `cloud-prices.json`, never typed.
 *
 * The export lists every size the console offers with its monthly price, and
 * each price is the rate card's two lines (CPU, memory), each rounded to the
 * cent, then summed (saas `public-prices.ts` `quoteDials`). So the per-unit
 * rates are a two-variable fit over a region's sizes, rounded to the four
 * decimals the rate card prices in. `unitRateMismatches` re-prices every size
 * from the rates the same way the exporter does; `check_cloud_prices.mjs`
 * fails the build if any size comes out different, so a rate shown on the
 * page cannot drift from what the console bills.
 *
 * Plain JavaScript so that the checker (plain Node) and the page (Astro) read
 * the same code.
 */

/** @param {string} cpu `"100m"` or `"1"` */
export function millicores(cpu) {
    return cpu.endsWith("m") ? Number(cpu.slice(0, -1)) : Number(cpu) * 1000;
}

/** @param {string} memory `"384Mi"` or `"2Gi"` */
export function mebibytes(memory) {
    return memory.endsWith("Gi") ? Number(memory.slice(0, -2)) * 1024 : Number(memory.slice(0, -2));
}

const cents = (/** @type {number} */ n) => Math.round(n * 100) / 100;
const rate4 = (/** @type {number} */ n) => Math.round(n * 1e4) / 1e4;

/**
 * @typedef {{ cpu: string; memory: string; monthlyEur: number }} SizePrice
 * @typedef {{ perMillicore: number; perMib: number }} PairRate
 * @typedef {{ app: PairRate; database: PairRate; diskPerGib: number }} UnitRates
 */

/**
 * Least squares over `price ≈ a·millicores + b·MiB`, rounded to 4 decimals.
 * @param {SizePrice[]} sizes
 * @returns {PairRate}
 */
function fitPair(sizes) {
    let sxx = 0, sxy = 0, syy = 0, sxp = 0, syp = 0;
    for (const s of sizes) {
        const x = millicores(s.cpu), y = mebibytes(s.memory), p = s.monthlyEur;
        sxx += x * x; sxy += x * y; syy += y * y; sxp += x * p; syp += y * p;
    }
    const det = sxx * syy - sxy * sxy;
    if (det === 0) throw new Error("cannot separate CPU from memory: every size has the same shape");
    return { perMillicore: rate4((sxp * syy - syp * sxy) / det), perMib: rate4((syp * sxx - sxp * sxy) / det) };
}

/** A size's monthly price at a pair of rates, rounded per line as the exporter rounds. */
export function priceAt(/** @type {PairRate} */ rate, /** @type {string} */ cpu, /** @type {string} */ memory) {
    return cents(cents(millicores(cpu) * rate.perMillicore) + cents(mebibytes(memory) * rate.perMib));
}

/**
 * @param {{ app: SizePrice[]; database: SizePrice[]; diskEurPerGib: number }} region
 * @returns {UnitRates}
 */
export function unitRates(region) {
    return { app: fitPair(region.app), database: fitPair(region.database), diskPerGib: region.diskEurPerGib };
}

/**
 * Every size whose listed price the derived rates do not reproduce. Empty is the pass.
 * @param {{ app: SizePrice[]; database: SizePrice[]; diskEurPerGib: number }} region
 * @returns {string[]}
 */
export function unitRateMismatches(region) {
    const r = unitRates(region);
    const out = [];
    for (const [list, rate] of /** @type {const} */ ([["app", r.app], ["database", r.database]])) {
        for (const s of region[list]) {
            const got = priceAt(rate, s.cpu, s.memory);
            if (got !== s.monthlyEur) out.push(`${list} ${s.cpu}/${s.memory}: listed €${s.monthlyEur}, the derived rates give €${got}`);
        }
    }
    return out;
}
