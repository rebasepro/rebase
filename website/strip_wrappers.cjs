const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "src", "pages");
const files = fs.readdirSync(dir).filter(f => f.startsWith("rebase-vs-"));

for (const file of files) {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, "utf8");

  // The exact string that opens the wrapper
  const wrapperTop = "<div class=\"p-8 rounded-2xl bg-surface-900/30 border border-surface-800/60 relative overflow-hidden group hover:border-surface-700 transition-colors\">\n            <!-- Subtle gradient background -->\n            <div class=\"absolute inset-0 bg-gradient-to-br from-surface-800/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity\"></div>\n            \n            <div class=\"relative\">";

  if (content.indexOf(wrapperTop) === -1) {
      console.log(`Wrapper not found in ${file}`);
  } else {
      content = content.split(wrapperTop).join("<div class=\"py-2\">");
  }

  // The exact string that closes the wrapper
  const wrapperBottom = "              </div>\n            </div>\n          </div>";
  if (content.indexOf(wrapperBottom) === -1) {
      console.log(`Bottom wrapper not found in ${file}`);
  } else {
      content = content.split(wrapperBottom).join("              </div>\n          </div>");
  }

  fs.writeFileSync(filePath, content);
  console.log(`Stripped wrappers in ${file}`);
}
