const fs = require('fs');
const lerna = JSON.parse(fs.readFileSync('lerna.json'));
lerna.command = { version: { syncWorkspaceLock: false } };
fs.writeFileSync('lerna.json', JSON.stringify(lerna, null, 2));
