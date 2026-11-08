import { useContext } from "react";
import { RebaseData } from "@rebasepro/types";
import { RebaseDataContext } from "../../contexts/RebaseDataContext";

/**
 * The admin's own data layer: every collection routed to its data source,
 * read in the admin's `Entity` view model. An app reads rows with `useRows`,
 * `useRow` and `context.data`, and writes them with `useRowWrites`.
 *
 * @internal
 */
export const useData = (): RebaseData => {
    const data = useContext(RebaseDataContext);
    if (!data) throw new Error("useData must be used inside <Rebase>");
    return data;
};
