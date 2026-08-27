import React from "react";
import { AnalyticsController } from "@rebasepro/cms-types";

export const AnalyticsContext = React.createContext<AnalyticsController>({} as AnalyticsController);
