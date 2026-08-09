import { isScaffoldedLocalDatabase } from "../src/PostgresBootstrapper";

/**
 * Who still hears "you are connected as a superuser".
 *
 * The advisory was the only WARN a brand-new project ever saw, and it was about
 * a decision the tool had made on the developer's behalf: the scaffold's own
 * `docker-compose.yml` sets `POSTGRES_USER: rebase_app`, which makes that role
 * the cluster superuser. Telling someone to fix a thing you did to them, with
 * no scaffolded way to fix it, trains them to ignore the only warning channel
 * they have.
 *
 * The narrowing has to be narrow, though, or it silences the advisory for the
 * deployments it exists for. The line below is the whole contract: quiet only
 * for a non-production process talking to a database on the loopback
 * interface. Every other shape — production anywhere, a dev machine pointed at
 * a remote or compose-networked database, an unreadable connection string —
 * still warns. The dev-machine-to-remote-database case matters most: that is
 * where a superuser connection is a live problem and the advice is exactly
 * right, so it must not be swept up by "it's only development".
 */
describe("isScaffoldedLocalDatabase", () => {
    const SCAFFOLD = "postgresql://rebase_app:changeme@127.0.0.1:5435/rebase?options=-c%20search_path=public";
    const REMOTE = "postgresql://postgres:pw@db.prod.example.com:5432/app";

    const nodeEnv = process.env.NODE_ENV;
    afterEach(() => {
        if (nodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = nodeEnv;
    });

    describe("outside production", () => {
        beforeEach(() => {
            delete process.env.NODE_ENV;
        });

        it("recognises the connection string `rebase init` writes", () => {
            expect(isScaffoldedLocalDatabase(SCAFFOLD)).toBe(true);
        });

        it("recognises the other spellings of the local machine", () => {
            expect(isScaffoldedLocalDatabase("postgres://u:p@localhost:5432/d")).toBe(true);
            expect(isScaffoldedLocalDatabase("postgres://u:p@127.0.0.2:5432/d")).toBe(true);
            expect(isScaffoldedLocalDatabase("postgres://u:p@[::1]:5432/d")).toBe(true);
        });

        // The case the narrowing must not swallow.
        it("still warns when a dev process points at a remote database", () => {
            expect(isScaffoldedLocalDatabase(REMOTE)).toBe(false);
        });

        // `db:5432` from inside a compose network is not this machine, and a
        // container that reaches a superuser over a docker network is the
        // deployment shape the advisory is written for.
        it("still warns for a compose service name", () => {
            expect(isScaffoldedLocalDatabase("postgresql://rebase_app:pw@db:5432/rebase")).toBe(false);
        });

        it("warns rather than guessing when there is nothing to read", () => {
            expect(isScaffoldedLocalDatabase(undefined)).toBe(false);
            expect(isScaffoldedLocalDatabase("")).toBe(false);
            expect(isScaffoldedLocalDatabase("not a url")).toBe(false);
        });
    });

    describe("in production", () => {
        beforeEach(() => {
            process.env.NODE_ENV = "production";
        });

        // A production process on a loopback database — a sidecar, a socket
        // proxy, a single-box deploy — is a genuine production superuser
        // connection, which is precisely what the advisory is for.
        it("warns even on loopback", () => {
            expect(isScaffoldedLocalDatabase(SCAFFOLD)).toBe(false);
            expect(isScaffoldedLocalDatabase("postgres://u:p@localhost:5432/d")).toBe(false);
        });

        it("warns for a remote database", () => {
            expect(isScaffoldedLocalDatabase(REMOTE)).toBe(false);
        });
    });
});
