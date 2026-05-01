import { resolveCollectionRelations, findRelation } from "@rebasepro/common";
import postsCollection from "./config/collections/posts";

const resolved = resolveCollectionRelations(postsCollection);
console.log("Resolved Keys:", Object.keys(resolved));
console.log("Has 'profile'?", !!resolved["profile"]);
console.log("Has 'author_profile'?", !!resolved["author_profile"]);

console.log("findRelation('author_profile'):", !!findRelation(resolved, "author_profile"));
