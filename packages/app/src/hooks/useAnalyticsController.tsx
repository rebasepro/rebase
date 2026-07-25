import { useContext } from "react";
import { AnalyticsController } from "@rebasepro/admin-types";
import { AnalyticsContext } from "../contexts/AnalyticsContext";

/**
 * @group Hooks and utilities
 */
export const useAnalyticsController = (): AnalyticsController => useContext(AnalyticsContext);
