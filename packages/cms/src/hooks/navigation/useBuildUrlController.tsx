import type { UrlController, NavigateOptions } from "@rebasepro/cms-types";
import { useCallback, useMemo } from "react";
import { removeInitialAndTrailingSlashes, resolveCollectionPathIds } from "@rebasepro/app";
import { CollectionRegistryController } from "@rebasepro/types";
import { useNavigate } from "react-router";
import { decodeUrlPath, encodeUrlPath } from "./url_segments";

export function useBuildUrlController(props: {
    basePath: string,
    baseCollectionPath: string,
    collectionRegistryController: CollectionRegistryController
}): UrlController {

    const { basePath, baseCollectionPath, collectionRegistryController } = props;
    const navigate = useNavigate();

    const homeUrl = basePath === "/" ? "/" : `/${removeInitialAndTrailingSlashes(basePath)}`;

    // `path` is a data path: each of its segments, record ids included, is
    // written percent-encoded, and a query or hash goes after the result.
    const buildUrlCollectionPath = useCallback((path: string): string => {
        const urlPath = encodeUrlPath(path);
        const fullPath = basePath === "/" ? `${baseCollectionPath}/${urlPath}` : `${basePath}${baseCollectionPath}/${urlPath}`;
        return fullPath.replace(/\/\//g, "/");
    }, [basePath, baseCollectionPath]);

    const buildAppUrlPath = useCallback((path: string): string => {
        const fullPath = basePath === "/" ? `/${path}` : `${basePath}/${path}`;
        return fullPath.replace(/\/\//g, "/");
    }, [basePath]);

    const urlPathToDataPath = useCallback((cmsPath: string): string => {
        let path = cmsPath;
        if (basePath !== "/" && path.startsWith(basePath)) {
            path = path.replace(basePath, "");
        }
        if (path.startsWith(baseCollectionPath)) {
            path = path.replace(baseCollectionPath, "");
        }
        // The pathname arrives percent-encoded, by the browser or by
        // `buildUrlCollectionPath`; the data path holds the ids themselves.
        return decodeUrlPath(removeInitialAndTrailingSlashes(path));
    }, [basePath, baseCollectionPath]);

    const isUrlCollectionPath = useCallback((urlPath: string): boolean => {
        let path = urlPath;
        if (basePath !== "/" && path.startsWith(basePath)) {
            path = path.replace(basePath, "");
        }
        return path === baseCollectionPath || path.startsWith(baseCollectionPath + "/");
    }, [basePath, baseCollectionPath]);

    const resolveDatabasePathsFrom = useCallback((path: string): string => {
        return resolveCollectionPathIds(path, collectionRegistryController.collections ?? []);
    }, [collectionRegistryController]);

    const navigateTo = useCallback((to: string, options?: NavigateOptions) => {
        navigate(to, options);
    }, [navigate]);

    return useMemo(() => ({
        basePath,
        baseCollectionPath,
        urlPathToDataPath,
        homeUrl,
        isUrlCollectionPath,
        buildUrlCollectionPath,
        buildAppUrlPath,
        resolveDatabasePathsFrom,
        navigate: navigateTo
    }), [basePath, baseCollectionPath, urlPathToDataPath, homeUrl, isUrlCollectionPath, buildUrlCollectionPath, buildAppUrlPath, resolveDatabasePathsFrom, navigateTo]);
}
