import { useContext } from "react";
import { BreadcrumbContext } from "../contexts/BreacrumbsContext";
import { BreadcrumbEntry, BreadcrumbsController } from "@rebasepro/cms-types";

export type { BreadcrumbEntry, BreadcrumbsController };


/**
 * Hook to retrieve the BreadcrumbsController.
 *
 * Consider that in order to use this hook you need to have a parent
 * `Rebase`
 *
 * @see BreadcrumbsController
 * @group Hooks and utilities
 */
export const useBreadcrumbsController = (): BreadcrumbsController => useContext(BreadcrumbContext);
