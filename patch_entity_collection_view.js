const fs = require('fs');
const path = '/Users/francesco/rebase/packages/cms/src/components/EntityCollectionView/EntityCollectionView.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Change docsCount state
content = content.replace(
    'const [docsCount, setDocsCount] = useState<number | undefined>(undefined);',
    'const [docsCount, setDocsCount] = useState<number | null | undefined>(null);'
);

// 2. Change the useEffect for updating breadcrumbs
content = content.replace(
    `        // Update breadcrumb count when count changes (only if loaded)
        useEffect(() => {
            if (docsCount !== undefined) {
                breadcrumbs.updateCount(path, docsCount);
            }
        }, [docsCount, path, breadcrumbs.updateCount]);`,
    `        // Update breadcrumb count when count changes
        useEffect(() => {
            breadcrumbs.updateCount(path, docsCount);
        }, [docsCount, path, breadcrumbs.updateCount]);`
);

// 3. Change EntitiesCount props
content = content.replace(
    'onCountChange?: (count: number) => void,',
    'onCountChange?: (count: number | null | undefined) => void,'
);

// 4. Update EntitiesCount implementation
const oldEntitiesCountImpl = `    const dataClient = useData();
    const navigation = useCollectionRegistryController();
    const [count, setCount] = useState<number | undefined>(undefined);
    const [error, setError] = useState<Error | undefined>(undefined);

    const sortByProperty = sortBy ? sortBy[0] : undefined;
    const currentSort = sortBy ? sortBy[1] : undefined;
    // v4: use path directly instead of resolveIdsFrom
    const resolvedPath = path;

    useEffect(() => {
        const accessor = dataClient.collection(resolvedPath);
        if (accessor.count) {
            // Convert filterValues to PostgREST where clause
            const whereMap: Record<string, string> = {};
            if (filter) {
                Object.entries(filter).forEach(([key, value]) => {
                    if (value && Array.isArray(value)) {
                        const [op, val] = value;
                        const postgrestOp = op === "==" ? "eq" : op === "!=" ? "neq" : op === ">" ? "gt" : op === ">=" ? "gte" : op === "<" ? "lt" : op === "<=" ? "lte" : op === "in" ? "in" : op === "not-in" ? "nin" : op === "array-contains" ? "cs" : op === "array-contains-any" ? "csa" : "eq";
                        
                        let stringVal: string;
                        if (Array.isArray(val)) {
                            stringVal = \`(\${val.join(",")})\`;
                        } else {
                            stringVal = String(val);
                        }
                        whereMap[key] = \`\${postgrestOp}.\${stringVal}\`;
                    }
                });
            }
            const whereParams = Object.keys(whereMap).length > 0 ? whereMap : undefined;
            const orderByParams = sortByProperty ? \`\${String(sortByProperty)}:\${currentSort}\` : undefined;

            accessor.count({
                where: whereParams,
                orderBy: orderByParams
            }).then(setCount).catch(setError);
        }
    }, [path, resolvedPath, collection, filter, sortByProperty, currentSort, dataClient]);

    useEffect(() => {
        if (onCountChange && count !== undefined) {
            setError(undefined);
            onCountChange(count);
        }
    }, [onCountChange, count]);

    if (error) {
        return null;
    }`;

const newEntitiesCountImpl = `    const dataClient = useData();
    const navigation = useCollectionRegistryController();

    const sortByProperty = sortBy ? sortBy[0] : undefined;
    const currentSort = sortBy ? sortBy[1] : undefined;
    // v4: use path directly instead of resolveIdsFrom
    const resolvedPath = path;

    useEffect(() => {
        const accessor = dataClient.collection(resolvedPath);
        if (accessor.count) {
            if (onCountChange) onCountChange(null);
            
            // Convert filterValues to PostgREST where clause
            const whereMap: Record<string, string> = {};
            if (filter) {
                Object.entries(filter).forEach(([key, value]) => {
                    if (value && Array.isArray(value)) {
                        const [op, val] = value;
                        const postgrestOp = op === "==" ? "eq" : op === "!=" ? "neq" : op === ">" ? "gt" : op === ">=" ? "gte" : op === "<" ? "lt" : op === "<=" ? "lte" : op === "in" ? "in" : op === "not-in" ? "nin" : op === "array-contains" ? "cs" : op === "array-contains-any" ? "csa" : "eq";
                        
                        let stringVal: string;
                        if (Array.isArray(val)) {
                            stringVal = \`(\${val.join(",")})\`;
                        } else {
                            stringVal = String(val);
                        }
                        whereMap[key] = \`\${postgrestOp}.\${stringVal}\`;
                    }
                });
            }
            const whereParams = Object.keys(whereMap).length > 0 ? whereMap : undefined;
            const orderByParams = sortByProperty ? \`\${String(sortByProperty)}:\${currentSort}\` : undefined;

            accessor.count({
                where: whereParams,
                orderBy: orderByParams
            }).then((c) => {
                if (onCountChange) onCountChange(c);
            }).catch((e) => {
                console.warn("Error fetching count", e);
                if (onCountChange) onCountChange(undefined);
            });
        } else {
            if (onCountChange) onCountChange(undefined);
        }
    }, [path, resolvedPath, collection, filter, sortByProperty, currentSort, dataClient]);`;

content = content.replace(oldEntitiesCountImpl, newEntitiesCountImpl);

fs.writeFileSync(path, content);
console.log("Patched");
