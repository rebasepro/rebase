import React from "react";
import { AuthController } from "@rebasepro/cms-types";

/** `null` outside `<Rebase>` — see {@link RebaseDataContext}. */
export const AuthControllerContext = React.createContext<AuthController<any, any> | null>(null);
