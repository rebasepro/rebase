import type { Transport } from "./transport";
import { RebaseClientError } from "@rebasepro/types";

/**
 * Call a SQL function the backend declares with `defineRpc`:
 * `POST /rpc/<name>` with the named arguments as the JSON body.
 *
 * Resolves to the function's result: an array (of rows, or of values) for a
 * set-returning function, the row or the value for any other, `null` for
 * `void`. Runs as the signed-in user, or anonymously when nobody is.
 *
 * ```ts
 * const proposal = await client.rpc<Proposal | null>("get_public_proposal", { token });
 * ```
 *
 * The arguments can be typed from the declaration, which a frontend imports
 * as a type: `client.rpc<Proposal, RpcArgs<typeof getPublicProposal>>(…)`.
 */
export type RpcCall = <T = unknown, A extends Record<string, unknown> = Record<string, unknown>>(
    name: string,
    args?: A
) => Promise<T>;

/** The SQL identifier an RPC name is. */
const RPC_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** @internal */
export function createRpcCall(transport: Transport): RpcCall {
    return <T = unknown, A extends Record<string, unknown> = Record<string, unknown>>(name: string, args?: A): Promise<T> => {
        if (!RPC_NAME.test(name)) {
            throw new RebaseClientError(
                `Invalid RPC name "${name}": an RPC is named after its SQL function — letters, digits and _, ` +
                "not starting with a digit.",
                { code: "INVALID_RPC_NAME", details: { name } }
            );
        }
        return transport.request<T>(`/rpc/${name}`, {
            method: "POST",
            body: JSON.stringify(args ?? {})
        });
    };
}
