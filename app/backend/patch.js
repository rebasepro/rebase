const fs = require("fs");
let content = fs.readFileSync("/Users/francesco/rebase/app/config/collections/posts.ts", "utf8");
content = content.replace("export default postsCollection;", `
postsCollection.securityRules = [
    {
        name: "test_policy",
        as: "permissive",
        for: "all",
        to: ["public"],
        using: "true"
    }
];

export default postsCollection;
`);
fs.writeFileSync("/Users/francesco/rebase/app/config/collections/posts.ts", content);
