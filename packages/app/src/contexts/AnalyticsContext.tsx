import React from "react";
import { AnalyticsController } from "@rebasepro/admin-types";

export const AnalyticsContext = React.createContext<AnalyticsController>({} as AnalyticsController);
