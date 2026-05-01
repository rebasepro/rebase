const fs = require('fs');
const path = require('path');
const glob = require('glob'); // Note: we might not have glob, but we can write a simple recursive function

function walk(dir, done) {
  let results = [];
  fs.readdir(dir, function(err, list) {
    if (err) return done(err);
    let pending = list.length;
    if (!pending) return done(null, results);
    list.forEach(function(file) {
      file = path.resolve(dir, file);
      fs.stat(file, function(err, stat) {
        if (stat && stat.isDirectory()) {
          if (file.includes('node_modules') || file.includes('dist') || file.includes('.git') || file.includes('.yarn')) {
            if (!--pending) done(null, results);
            return;
          }
          walk(file, function(err, res) {
            results = results.concat(res);
            if (!--pending) done(null, results);
          });
        } else {
          if (!file.endsWith('.js') && !file.endsWith('.ts') && !file.endsWith('.tsx') && !file.endsWith('.jsx') && !file.endsWith('.json') && !file.endsWith('.md') && !file.endsWith('.html') && !file.endsWith('.mjs')) {
            if (!--pending) done(null, results);
            return;
          }
          if (file.includes('pnpm-lock.yaml')) {
             if (!--pending) done(null, results);
             return;
          }
          results.push(file);
          if (!--pending) done(null, results);
        }
      });
    });
  });
}

walk('.', function(err, results) {
  if (err) throw err;
  let count = 0;
  for (const file of results) {
    let content = fs.readFileSync(file, 'utf8');
    let newContent = content
        .replace(/@rebasepro\/cms/g, '@rebasepro/admin')
        .replace(/packages\/cms/g, 'packages/admin')
        .replace(/app\/shared/g, 'app/config')
        .replace(/template\/shared/g, 'template/config');

    if (content !== newContent) {
      fs.writeFileSync(file, newContent, 'utf8');
      count++;
    }
  }
  console.log('Modified files:', count);
});
