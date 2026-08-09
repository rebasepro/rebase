// Renders `rebase_cto_technical_handbook.md` at the repo root to the sibling
// `.html`. Lives here rather than at the root because AGENT.md's own rule says
// one-off utility scripts belong in `/scripts/`, and this file was the example
// of the root clutter that rule exists to prevent.
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const mdPath = path.join(repoRoot, 'rebase_cto_technical_handbook.md');
const htmlPath = path.join(repoRoot, 'rebase_cto_technical_handbook.html');

if (!fs.existsSync(mdPath)) {
    console.error('Markdown file not found at:', mdPath);
    process.exit(1);
}

const text = fs.readFileSync(mdPath, 'utf-8');

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function mdToHtml(md) {
    const lines = md.split('\n');
    let htmlLines = [];
    let inCode = false;
    let inTable = false;
    let tableLines = [];

    for (let line of lines) {
        if (line.startsWith('```')) {
            if (inCode) {
                htmlLines.push('</pre>');
                inCode = false;
            } else {
                htmlLines.push('<pre style="background-color: #2d3748; color: #f7fafc; padding: 12px; border-radius: 6px; font-family: monospace; font-size: 13px; overflow-x: auto;">');
                inCode = true;
            }
            continue;
        }

        if (inCode) {
            htmlLines.push(escapeHtml(line));
            continue;
        }

        if (line.startsWith('|') && line.endsWith('|')) {
            if (!inTable) {
                inTable = true;
                tableLines = [line];
            } else {
                tableLines.push(line);
            }
            continue;
        } else if (inTable) {
            inTable = false;
            htmlLines.push('<table border="1" style="border-collapse: collapse; width: 100%; margin: 16px 0;">');
            let header = true;
            for (let tline of tableLines) {
                let cells = tline.split('|').slice(1, -1).map(c => c.trim());
                if (cells.every(c => c.startsWith(':') || c.startsWith('-') || c.endsWith('-') || c === '')) {
                    header = false;
                    continue;
                }
                let tag = header ? 'th' : 'td';
                let style = header ? 'style="background-color: #f7fafc; padding: 10px; border: 1px solid #e2e8f0; text-align: left;"' : 'style="padding: 10px; border: 1px solid #e2e8f0;"';
                htmlLines.push('<tr>' + cells.map(c => `<${tag} ${style}>${escapeHtml(c)}</${tag}>`).join('') + '</tr>');
            }
            htmlLines.push('</table>');
            tableLines = [];
        }

        if (line.startsWith('# ')) {
            htmlLines.push(`<h1 style="color: #1a202c; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-top: 32px;">${escapeHtml(line.slice(2))}</h1>`);
        } else if (line.startsWith('## ')) {
            htmlLines.push(`<h2 style="color: #2d3748; margin-top: 28px; border-bottom: 1px solid #edf2f7; padding-bottom: 6px;">${escapeHtml(line.slice(3))}</h2>`);
        } else if (line.startsWith('### ')) {
            htmlLines.push(`<h3 style="color: #4a5568; margin-top: 20px;">${escapeHtml(line.slice(4))}</h3>`);
        } else if (line.startsWith('#### ')) {
            htmlLines.push(`<h4 style="color: #718096;">${escapeHtml(line.slice(5))}</h4>`);
        } else if (line.startsWith('> ')) {
            htmlLines.push(`<blockquote style="border-left: 4px solid #3182ce; background: #ebf8ff; color: #2b6cb0; margin: 16px 0; padding: 12px 16px;">${escapeHtml(line.slice(2))}</blockquote>`);
        } else if (line.startsWith('- ') || line.startsWith('* ')) {
            htmlLines.push(`<li>${escapeHtml(line.slice(2))}</li>`);
        } else if (line.trim() === '---') {
            htmlLines.push('<hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;"/>');
        } else if (line.trim() === '') {
            htmlLines.push('<br/>');
        } else {
            htmlLines.push(`<p>${escapeHtml(line)}</p>`);
        }
    }

    let content = htmlLines.join('\n');
    content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    content = content.replace(/\*(.*?)\*/g, '<em>$1</em>');
    content = content.replace(/`([^`]+)`/g, '<code style="background: #edf2f7; padding: 2px 6px; border-radius: 4px; font-family: monospace;">$1</code>');
    return content;
}

const bodyHtml = mdToHtml(text);

const fullHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Rebase CTO Master Technical Handbook</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #2d3748; max-width: 900px; margin: 0 auto; padding: 40px 20px; }
h1, h2, h3, h4 { font-weight: 600; line-height: 1.25; }
code { font-family: SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace; }
table { border-collapse: collapse; width: 100%; margin: 16px 0; }
th, td { border: 1px solid #e2e8f0; padding: 10px 12px; font-size: 14px; }
th { background-color: #f7fafc; }
blockquote { margin: 16px 0; padding: 12px 16px; background-color: #ebf8ff; border-left: 4px solid #3182ce; color: #2b6cb0; }
pre { background-color: #2d3748; color: #f7fafc; padding: 16px; border-radius: 6px; overflow-x: auto; font-size: 13px; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

fs.writeFileSync(htmlPath, fullHtml, 'utf-8');
console.log('Successfully generated HTML handbook at:', htmlPath);
