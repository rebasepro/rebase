import path from "node:path";

/**
 * The signed-in session, captured once by globalSetup and replayed by every
 * test that needs to be logged in but is not testing logging in.
 *
 * Seven of the ten tests used to drive the whole login sequence in `beforeEach`
 * — checkbox, "Sign in with email", wait for the form, submit, wait for the
 * sidebar — so a single run performed it ten times. Any one of those losing a
 * race failed the *setup*, which fails every test in the file at once and reads
 * as "the e2e is flaky" rather than "login was slow". Doing it once, with
 * retries, means a bad login costs a retry instead of a red suite.
 *
 * `smoke.spec.ts` and `e2e.spec.ts` deliberately do not use this: they are the
 * tests that exercise the login view itself, and must start signed out.
 */
export const AUTH_STATE = path.join(__dirname, ".auth", "user.json");
