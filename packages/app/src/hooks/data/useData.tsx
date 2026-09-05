import { useContext } from "react";
import { RebaseData } from "@rebasepro/types";
import { RebaseDataContext } from "../../contexts/RebaseDataContext";

/**
 * Use this hook to access the unified data API.
 *
 * ```ts
 * const data = useData();
 * const { data: products } = await data.products.find({ where: { status: ["==", "published"] } });
 * await data.products.create({ name: "Camera", price: 299 });
 * ```
 *
 * @group Hooks and utilities
 */
export const useData = (): RebaseData => {
    const data = useContext(RebaseDataContext);
    if (!data) throw new Error("useData must be used inside <Rebase>");
    return data;
};
