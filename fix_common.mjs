import fs from "fs";

// Fix CollectionRegistry.ts
let colReg = fs.readFileSync("packages/common/src/collections/CollectionRegistry.ts", "utf8");
colReg = colReg.replace(/collection\.relations/g, "(collection as any).relations");
fs.writeFileSync("packages/common/src/collections/CollectionRegistry.ts", colReg);

// Fix conditions.ts
let cond = fs.readFileSync("packages/common/src/util/conditions.ts", "utf8");
cond = cond.replace(/property\.disabled/g, "property.ui?.disabled");
cond = cond.replace(/property\.readOnly/g, "property.ui?.readOnly");
fs.writeFileSync("packages/common/src/util/conditions.ts", cond);

// Fix relations.ts
let rel = fs.readFileSync("packages/common/src/util/relations.ts", "utf8");
rel = rel.replace(/\(targetCollection as CollectionWithRelations\)\.relations/g, "((targetCollection as any).relations)");
rel = rel.replace(/relCollection\.relations/g, "(relCollection as any).relations");
rel = rel.replace(/\(sourceCollection as CollectionWithRelations\)\.relations/g, "((sourceCollection as any).relations)");
fs.writeFileSync("packages/common/src/util/relations.ts", rel);

// Fix resolutions.ts
let res = fs.readFileSync("packages/common/src/util/resolutions.ts", "utf8");
res = res.replace(/\(collection as CollectionWithRelations\)\.relations/g, "((collection as any).relations)");
res = res.replace(/filter\(\(c\): c is EntityCollection/g, "filter((c: any): c is EntityCollection");
fs.writeFileSync("packages/common/src/util/resolutions.ts", res);

