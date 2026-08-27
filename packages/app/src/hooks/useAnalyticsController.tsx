import { useContext } from "react";
import { AnalyticsController } from "@rebasepro/cms-types";
import { AnalyticsContext } from "../contexts/AnalyticsContext";

/**
 * @group Hooks and utilities
 */
export const useAnalyticsController = (): AnalyticsController => useContext(AnalyticsContext);
