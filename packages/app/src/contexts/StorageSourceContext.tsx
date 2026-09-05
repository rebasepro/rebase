import React from "react";
import { StorageSource } from "@rebasepro/types";

/**
 * Three states, and they mean different things:
 *
 * - `null` — outside `<Rebase>`.
 * - `undefined` — inside it, but the project configured no storage. `<Rebase>`
 *   already warns about this on the console.
 * - a source — the resolved default storage.
 *
 * See {@link RebaseDataContext} for why the default is not `{}`.
 */
export const StorageSourceContext = React.createContext<StorageSource | null | undefined>(null);
