import React from "react";
import { RebaseData } from "@rebasepro/cms-types";

/**
 * `null` outside `<Rebase>`, so {@link useData} can say so.
 *
 * The default used to be `{} as RebaseData` — a lie the type system agreed
 * with. A hook called outside the tree handed back an empty object, and the
 * first thing anyone does with it is `data.table("posts")`, which fails as
 * "data.table is not a function" somewhere in a component's render. That
 * names neither the hook nor the missing provider.
 */
export const RebaseDataContext = React.createContext<RebaseData | null>(null);
