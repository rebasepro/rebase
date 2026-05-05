import fs from "fs";

const stats = JSON.parse(fs.readFileSync("stats.json", "utf8"));

const packages = new Map();

for (const [metaUid, meta] of Object.entries(stats.nodeMetas)) {
    const moduleId = meta.id;
    if (!moduleId) continue;
    
    // Find if it's in the index chunk
    let size = 0;
    let isInIndex = false;
    for (const [chunkName, partUid] of Object.entries(meta.moduleParts || {})) {
        if (chunkName.includes("index-")) {
            isInIndex = true;
            const part = stats.nodeParts[partUid];
            if (part) {
                size += part.renderedLength || 0;
            }
        }
    }
    
    if (isInIndex) {
        const match = moduleId.match(/node_modules\/((?:@[^\/]+\/)?[^\/]+)/);
        let pkgName = match ? match[1] : null;
        if (!pkgName) {
            const pkgMatch = moduleId.match(/packages\/([^\/]+)/);
            pkgName = pkgMatch ? `packages/${pkgMatch[1]}` : "application code";
        }
        packages.set(pkgName, (packages.get(pkgName) || 0) + size);
    }
}

const sorted = Array.from(packages.entries()).sort((a, b) => b[1] - a[1]);
let total = 0;
for (const [name, size] of sorted) total += size;

console.log(`Main chunk total size: ${(total / 1024).toFixed(2)} KB`);
console.log("Top packages in main chunk:");
for (let i = 0; i < 20 && i < sorted.length; i++) {
    console.log(`${(sorted[i][1] / 1024).toFixed(2)} KB - ${sorted[i][0]}`);
}
