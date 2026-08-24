/**
 * testing-library resolves `waitFor` against a 1000ms default, which is a bet on
 * how quickly this machine schedules a microtask rather than on the component.
 * `pnpm -r test` runs every package's workers at once, so the bet is lost under
 * exactly the conditions CI creates — it surfaces as a timeout on whichever
 * assertion happened to sit inside the callback.
 *
 * Set globally rather than per call site, because these fail one at a time under
 * contention and patching the one that surfaced last just moves the flake.
 * Nothing is weakened: the callback still has to succeed, a component that never
 * settles still fails, and a timeout only has to stop a hang.
 */
import { configure } from "@testing-library/react";

configure({ asyncUtilTimeout: 15_000 });
