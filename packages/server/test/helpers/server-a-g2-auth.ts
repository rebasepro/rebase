/**
 * Shaping an `AuthRepository` fake for a test that needs one *without* some of
 * its optional methods — a host application's repository written before those
 * methods existed, which the routes must still serve.
 *
 * `mockAuthRepository()` mocks every method, optional ones included, and a
 * route that probes `repo.getAccountAccessState?.(…)` behaves differently when
 * the method is there and answers `undefined` than when it is absent. So a test
 * whose repository never had a method says so here, and the routes see the
 * shape the test means.
 */
import type { AuthRepository } from "../../src/auth/interfaces";

/** The methods an `AuthRepository` may leave out. */
export type OptionalAuthMethod = {
    [K in keyof AuthRepository]-?: undefined extends AuthRepository[K] ? K : never;
}[keyof AuthRepository];

/**
 * A copy of `repo` lacking `omit`. The methods it keeps are the same objects,
 * so a `mockResolvedValue` on the original still steers the copy.
 */
export function withoutMethods(repo: AuthRepository, omit: readonly OptionalAuthMethod[]): AuthRepository {
    if (omit.length === 0) return repo;
    const copy: AuthRepository = { ...repo };
    for (const key of omit) delete copy[key];
    return copy;
}
