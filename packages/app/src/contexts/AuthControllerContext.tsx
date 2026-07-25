import React from "react";
import { AuthController } from "@rebasepro/admin-types";

export const AuthControllerContext = React.createContext<AuthController<any, any>>({} as AuthController<any, any>);
