import { createServer, type RequestListener, type Server } from "http";

/**
 * The largest request line plus headers the runtime accepts, in bytes.
 *
 * Node's default is 16 KB, and a request over it is answered 431 before any
 * route sees it. The data API's own parameters reach that: a vector search
 * carries its embedding as a JSON array in `?vector=`, and 768 dimensions of it
 * are 16.7 KB of URL, 1,536 are 33 KB. 64 KB lets the common embedding sizes
 * through up to 1,536 dimensions.
 *
 * A stopgap, not the fix. The proxy in front of most deployments has its own
 * ceiling (nginx's is 8 KB) that no setting here moves, and 3,072 dimensions
 * are 67 KB. `POST /api/data/<collection>/query` carries the same parameters in
 * a body, and the SDK sends a vector search that way; this is for the URL a
 * person or another client builds by hand.
 *
 * Not higher, because the bound is what it costs to hold a connection that is
 * still sending its headers — the reason Node lowered it from 80 KB in 2018.
 */
export const RUNTIME_MAX_HEADER_SIZE = 64 * 1024;

/** The runtime's HTTP server, with the header bound above. */
export function createRuntimeHttpServer(listener: RequestListener): Server {
    return createServer({ maxHeaderSize: RUNTIME_MAX_HEADER_SIZE }, listener);
}
