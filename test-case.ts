import { toSnakeCase, toKebabCase } from "./packages/utils/src/strings";

console.log("snakeCase:");
console.log(toSnakeCase("myBlogPosts"));
console.log(toSnakeCase("my-blog-posts"));
console.log(toSnakeCase("my_blog_posts"));
console.log(toSnakeCase("MyBlogPosts"));

console.log("\nkebabCase:");
console.log(toKebabCase("myBlogPosts"));
console.log(toKebabCase("my-blog-posts"));
console.log(toKebabCase("my_blog_posts"));
console.log(toKebabCase("MyBlogPosts"));
