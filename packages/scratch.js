const options = { where: {} };
const parsedWhere = JSON.parse('{"__proto__":{"polluted":true}}');
Object.assign(options.where, parsedWhere);
console.log({}.polluted);
