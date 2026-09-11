/**
 * Run `task` over every item, at most `concurrency` at a time, and return the
 * results in the order the items were given.
 *
 * The bulk delete used to be `Promise.all(entities.map(performDelete))`. That is
 * fine for the handful of rows anyone could tick by hand, and it is the reason
 * a "select all matching" over a real collection could not simply be poured
 * into the existing dialog: twelve thousand entries in that array is twelve
 * thousand simultaneous requests, which the browser queues and the server takes
 * as a burst.
 *
 * Rejections are not swallowed and do not cancel: every task is run, and the
 * first rejection is thrown once they have all settled, so a bulk action cannot
 * half-apply and then report the failure as if nothing had happened.
 */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    concurrency: number,
    task: (item: T, index: number) => Promise<R>,
    onSettled?: (completed: number, total: number) => void
): Promise<R[]> {

    const results = new Array<R>(items.length);
    const limit = Math.max(1, Math.floor(concurrency));
    let next = 0;
    let completed = 0;
    let firstError: unknown;
    let failed = false;

    async function worker(): Promise<void> {
        for (; ;) {
            const index = next++;
            if (index >= items.length) return;
            try {
                results[index] = await task(items[index], index);
            } catch (e) {
                if (!failed) {
                    failed = true;
                    firstError = e;
                }
            }
            onSettled?.(++completed, items.length);
        }
    }

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

    if (failed) throw firstError;
    return results;
}
