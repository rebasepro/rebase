import { CollectionRegistry } from "./src/collections/CollectionRegistry";
import postsCollection from "../../app/config/collections/posts";

const registry = new CollectionRegistry([postsCollection]);
const posts = registry.get("posts");

console.log("Relations:", posts?.relations?.map(r => r.relationName));
console.log("Properties keys:", Object.keys(posts?.properties || {}));
console.log("Tags property:", posts?.properties?.tags);
