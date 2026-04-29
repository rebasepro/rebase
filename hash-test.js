const crypto = require("crypto");
const getPolicyNameHash = (rule) => {
    const data = JSON.stringify({
        a: rule.access,
        m: rule.mode,
        op: rule.operation,
        ops: rule.operations,
        own: rule.ownerField,
        rol: rule.roles ? [...rule.roles].sort() : undefined,
        pg: rule.pgRoles ? [...rule.pgRoles].sort() : undefined,
        u: rule.using,
        w: rule.withCheck
    });
    return crypto.createHash("sha1").update(data).digest("hex").substring(0, 7);
}

console.log(getPolicyNameHash({ operation: "read", roles: ["admin"] }));
