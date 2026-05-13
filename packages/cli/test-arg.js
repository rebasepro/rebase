import arg from "arg";
const args = arg({ "--output": String }, { argv: process.argv.slice(2), permissive: true });
console.log(args);
