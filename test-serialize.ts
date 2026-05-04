import { serializeDataToServer } from "./packages/server-postgresql/src/data-transformer";
import { posts } from "./app/config/collections/posts";

const values = {
    content: [
        { type: "text", value: "Hello world" }
    ]
};

const result = serializeDataToServer(values, posts as any);
console.log(JSON.stringify(result, null, 2));
