/**
 * A clock Neat can be driven by, instead of the one it wants.
 *
 * `@firecms/neat` animates the way every browser animation library does:
 *
 *     let tick = seed ?? getElapsedSecondsInLastHour();
 *     let lastTime = performance.now();
 *     const render = () => {
 *         const timeNow = performance.now();
 *         tick += ((timeNow - lastTime) / 1000) * this._speed;
 *         lastTime = timeNow;
 *         gl.uniform1f(locations.uniforms['u_time'], tick);
 *         ...
 *         if (this._isVisible) this.requestRef = requestAnimationFrame(render);
 *     };
 *
 * Two things there are incompatible with a renderer, and both are fixable
 * rather than fatal:
 *
 *   1. TIME COMES FROM THE WALL. A render seeks — it asks for frame 900
 *      without having drawn 899 — and a wall clock has no answer for "what did
 *      you look like at t = 30s". Renders would differ run to run.
 *   2. THE LOOP SCHEDULES ITSELF. Frames would arrive when the browser felt
 *      like it, not when Remotion asked for one.
 *
 * So both globals are replaced for exactly as long as the library's own code
 * is on the stack: `performance.now()` returns a number we choose, and
 * `requestAnimationFrame` parks the callback in a queue instead of scheduling
 * it. Remotion's own use of either is untouched, because the patch is removed
 * in a `finally` before control returns.
 *
 * The payoff is that `tick` becomes ABSOLUTE rather than accumulated. With
 * `seed: 0` and construction at t=0, the first call at fake time T yields
 * `tick = T * speed` whatever came before it — so a worker that starts at
 * frame 1200 produces exactly the image a worker that stepped through 1199
 * frames would. Seeking is safe, re-rendering one frame reproduces it, and
 * four parallel workers agree.
 */

export class DeterministicClock {
    private queued: FrameRequestCallback[] = [];
    private nowMs = 0;

    /** Runs `fn` with the clock pinned to `nowMs` and rAF captured. */
    run<T>(nowMs: number, fn: () => T): T {
        const realRaf = window.requestAnimationFrame;
        const realCancel = window.cancelAnimationFrame;
        const realNow = performance.now;

        this.nowMs = nowMs;
        window.requestAnimationFrame = (cb: FrameRequestCallback) => {
            this.queued.push(cb);
            return 0;
        };
        window.cancelAnimationFrame = () => undefined;
        performance.now = () => this.nowMs;

        try {
            return fn();
        } finally {
            window.requestAnimationFrame = realRaf;
            window.cancelAnimationFrame = realCancel;
            performance.now = realNow;
        }
    }

    /**
     * Moves the clock to `nowMs` and runs every callback waiting on it — once.
     * Callbacks re-register as they run, which is why the queue is taken
     * before draining rather than iterated in place.
     */
    advanceTo(nowMs: number) {
        const due = this.queued;
        this.queued = [];
        this.run(nowMs, () => {
            for (const cb of due) cb(nowMs);
        });
    }

    /** Whether anything is still driving the animation. A false here means a
     *  frozen gradient, and a frozen gradient is silent — so callers check. */
    get live() {
        return this.queued.length > 0;
    }
}
