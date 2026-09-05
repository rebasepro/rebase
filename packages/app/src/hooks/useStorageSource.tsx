import { StorageSource } from "@rebasepro/types";
import { StorageSourceContext } from "../contexts/StorageSourceContext";
import { useContext } from "react";

/**
 * Use this hook to get the storage source being used
 * @group Hooks and utilities
 */
export const useStorageSource = (): StorageSource => {
    const storageSource = useContext(StorageSourceContext);
    if (storageSource === null) throw new Error("useStorageSource must be used inside <Rebase>");
    // `undefined` is a different thing: inside the tree, but the project
    // configured no storage. `<Rebase>` warns about that on the console, and
    // every upload field then fails on its own. Throwing here instead would
    // take the whole admin down with it, because `useRebaseContext` calls this
    // unconditionally — so the return type stays a promise this hook cannot
    // keep, until the seven callers can be told the truth.
    return storageSource as StorageSource;
};
