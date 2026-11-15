/**
 * How long `rebase db pull` waits on the local database before it stops
 * waiting and says so.
 *
 * The managed database can stop answering without refusing anything. Its
 * daemon accepts the socket and never finishes the start-up handshake, or
 * finishes it and never answers a query. A pull from a LATIN1 database did
 * exactly that: pg_restore's `SET client_encoding = 'LATIN1'` left the daemon
 * answering nobody, and the re-grant that followed opened a connection with
 * no bound. The pull then hung for good, after it had already emptied the local
 * database and before it printed the failure it had already computed.
 *
 * Every connection a pull opens to the local database takes
 * {@link LOCAL_CONNECT_TIMEOUT_MS}. A connection whose statements are all short
 * also takes {@link LOCAL_QUERY_TIMEOUT_MS}: catalog reads, `RESET`, grants.
 * A connection that rewrites whole tables does not take it, because those
 * statements run as long as the tables are big.
 *
 * These live in their own module so that a test can shorten them for every
 * caller at once.
 */

/** The connection, start-up handshake included: a wedged daemon accepts the socket and never answers. */
export const LOCAL_CONNECT_TIMEOUT_MS = 10_000;

/** One short statement: a catalog read, a `RESET`, a `GRANT`. */
export const LOCAL_QUERY_TIMEOUT_MS = 15_000;
