

import { getSubcollections } from "@rebasepro/common";
import type { AdminCollection } from "@rebasepro/cms-types";

export function removeInitialAndTrailingSlashes(s: string): string {
    return removeInitialSlash(removeTrailingSlash(s));
}

export function removeInitialSlash(s: string) {
    if (s.startsWith("/"))
        return s.slice(1);
    else return s;
}

export function removeTrailingSlash(s: string) {
    if (s.endsWith("/"))
        return s.slice(0, -1);
    else return s;
}

export function addInitialSlash(s: string) {
    if (s.startsWith("/"))
        return s;
    else return `/${s}`;
}

export function getLastSegment(path: string) {
    const cleanPath = removeInitialAndTrailingSlashes(path);
    if (cleanPath.includes("/")) {
        const segments = cleanPath.split("/");
        return segments[segments.length - 1];
    }
    return cleanPath;
}

export function resolveCollectionPathIds(path: string, allCollections: AdminCollection[]): string {
    let remainingPath = removeInitialAndTrailingSlashes(path);
    if (!remainingPath) {
        return "";
    }

    let currentCollections: AdminCollection[] | undefined = allCollections;
    const resolvedPathParts: string[] = [];

    while (remainingPath.length > 0) {
        if (!currentCollections || currentCollections.length === 0) {
            // We have remaining path segments but no more collections to match against
            console.warn(`resolveCollectionPathIds: Path structure implies subcollections, but none found before segment starting with "${remainingPath}" in original path "${path}". Appending remaining original path.`);
            resolvedPathParts.push(remainingPath);
            remainingPath = ""; // Stop processing
            break;
        }

        let foundMatch = false;
        // Sort potential matches by length descending to prioritize longer matches (e.g., "a/b" over "a")
        const potentialMatches: { col: AdminCollection; match: string; }[] = currentCollections
            .flatMap(col => [{
                col,
                match: col.slug
            }])
            // Whole segments only: a bare `startsWith` read `users/abc123` as the
            // collection `user` followed by the id `s`.
            .filter(p => p.match && (remainingPath === p.match || remainingPath.startsWith(`${p.match}/`)))
            .sort((a, b) => b.match.length - a.match.length);

        if (potentialMatches.length > 0) {
            const {
                col: foundCollection,
                match: matchString
            } = potentialMatches[0];

            resolvedPathParts.push(foundCollection.slug); // Use the defined path
            remainingPath = removeInitialSlash(remainingPath.substring(matchString.length));

            // Check if we are at the end of the path
            if (remainingPath.length === 0) {
                foundMatch = true;
                break; // Path ends with a collection segment
            }

            // The next segment must be a entity ID
            const idSeparatorIndex = remainingPath.indexOf("/");
            let entityId: string | number;
            if (idSeparatorIndex > -1) {
                entityId = remainingPath.substring(0, idSeparatorIndex);
                remainingPath = remainingPath.substring(idSeparatorIndex + 1);
            } else {
                // This should not happen if the original path is valid (odd segments)
                // but handle it defensively: assume the rest is the ID
                entityId = remainingPath;
                remainingPath = "";
                console.warn(`resolveCollectionPathIds: Path seems to end with a entity ID "${entityId}" instead of a collection segment in original path "${path}". This might indicate an invalid input path.`);
                // Even if it ends here, we still need to push the ID
            }

            resolvedPathParts.push(entityId); // Append entity ID
            currentCollections = getSubcollections(foundCollection); // Move to subcollections
            foundMatch = true;

            if (!currentCollections && remainingPath.length > 0) {
                // Warn if the path continues but no subcollections were defined
                console.warn(`resolveCollectionPathIds: Path continues after entity ID "${entityId}", but no subcollections are defined for the preceding collection "${foundCollection.slug}" in path "${path}". Appending remaining original path.`);
                resolvedPathParts.push(remainingPath); // Append the rest
                remainingPath = ""; // Stop processing
                break;
            }

        }

        if (!foundMatch) {
            // Collection definition not found for the start of the remaining path
            console.warn(`resolveCollectionPathIds: Collection definition not found for segment starting with "${remainingPath}" in original path "${path}". Appending remaining original path.`);
            resolvedPathParts.push(remainingPath); // Append the rest
            remainingPath = ""; // Stop processing
            break;
        }
    }

    return resolvedPathParts.join("/");
}

/**
 * Find the corresponding view at any depth for a given path.
 * Note that path or segments of the paths can be collection aliases.
 * @param slugOrPath
 * @param collections
 */
export function getCollectionBySlugWithin(slugOrPath: string, collections: AdminCollection[]): AdminCollection | undefined {

    const path = removeInitialAndTrailingSlashes(slugOrPath);
    const subpathCombinations = getCollectionPathsCombinations(path.split("/"));
    let result: AdminCollection | undefined;
    for (let i = 0; i < subpathCombinations.length; i++) {
        const subpathCombination = subpathCombinations[i];
        const navigationEntry = collections && collections
            .sort((a, b) => (a.slug ?? "").localeCompare(b.slug ?? ""))
            .find((entry) => entry.slug === subpathCombination);

        if (navigationEntry) {
            // Counted from where the slug ends, not over the whole path, whose
            // count the slug's own slashes would decide. What follows a
            // collection pairs up as (entity id, subcollection), so an odd
            // remainder ends at a record.
            const rest = path.split("/").slice(subpathCombination.split("/").length);
            if (rest.length % 2 !== 0) {
                throw Error(`getCollectionBySlug: Collection paths must end at a collection, not at a record: ${slugOrPath}`);
            }
            if (rest.length === 0) {
                result = navigationEntry;
            } else if (getSubcollections(navigationEntry).length > 0) {
                result = getCollectionBySlugWithin(rest.slice(1).join("/"), getSubcollections(navigationEntry));
            }
        }
        if (result) break;
    }
    return result;
}

/**
 * Every leading run of whole segments of a path, longest first: the
 * candidates for the collection the path starts with.
 * "sites/es/locales" => ["sites/es/locales", "sites/es", "sites"]
 *
 * Every length, not only the odd ones. A slug may contain slashes, so
 * `content/podcasts/abc123/episodes` starts with the two-segment collection
 * `content/podcasts`, and a path's own segment count says nothing about where
 * its first collection ends.
 * @param subpaths
 */
export function getCollectionPathsCombinations(subpaths: string[]): string[] {
    const result: string[] = [];
    for (let i = subpaths.length; i > 0; i--) {
        result.push(subpaths.slice(0, i).join("/"));
    }
    return result;
}
