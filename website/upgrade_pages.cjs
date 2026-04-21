const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'src', 'pages');
const files = ['rebase-vs-django.astro', 'rebase-vs-hasura.astro'];

for (const file of files) {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // We know these files only have TWO points originally, but Point 1 was successfully upgraded because `<!-- Point 2 -->` existed.
  // Wait! If Point 1 was upgraded, the file content HAS CHANGED.
  // The script writes after all points are processed. So Point 1 WAS upgraded, Point 2 was skipped.
  // Wait, if I run the regex on Point 2 now, the bounds for Point 2 start at `<!-- Point 2 -->` and end at `\n        </div>\n\n      </div>`.
  
  for (let i = 2; i <= 2; i++) { // specifically target point 2
    const startStr = `<!-- Point ${i} -->`;
    
    let startIndex = content.indexOf(startStr);
    let endIndex = content.indexOf(`\n        </div>\n\n      </div>`, startIndex);
    
    if (startIndex === -1 || endIndex === -1) {
        console.error(`Could not find bounds for Point ${i} in ${file}`);
        continue;
    }
    
    let chunk = content.substring(startIndex, endIndex);

    const iconMatch = chunk.match(/<span class="material-symbols-rounded[^>]*>([^<]+)<\/span>/);
    const iconSpanClose = chunk.indexOf('</span>', chunk.indexOf('material-symbols-rounded'));
    const categoryDivClose = chunk.indexOf('</div>', iconSpanClose);
    const category = chunk.substring(iconSpanClose + 7, categoryDivClose).trim();

    const mainTitleMatch = chunk.match(/<h3 class="text-2xl font-bold text-white mb-4">([^<]+)<\/h3>/);
    const painTitleMatch = chunk.match(/<h4 class="text-white font-semibold mb-2">([^<]+)<\/h4>/);
    const painTextMatch = chunk.match(/<p class="text-surface-400 text-sm">([\s\S]*?)<\/p>/);
    
    const solutionTitleMatch = chunk.match(/<h4 class="text-white font-semibold text-lg mb-3">([^<]+)<\/h4>/);
    const solutionSummaryMatch = chunk.match(/<p class="text-surface-300 leading-relaxed mb-4">\s*([\s\S]*?)\s*<\/p>/);
    
    const ulMatch = chunk.match(/<ul class="text-surface-400 space-y-2 text-sm">\s*([\s\S]*?)<\/ul>/);

    if (iconMatch && mainTitleMatch && painTitleMatch && painTextMatch && solutionTitleMatch && solutionSummaryMatch && ulMatch) {
        let ulContent = ulMatch[1];
        ulContent = ulContent.replace(/<li><span class="text-primary mr-2">•<\/span>\s*([\s\S]*?)<\/li>/g, '<li class="flex items-start"><span class="material-symbols-rounded text-primary mr-2 mt-0.5" style="font-size:18px">done</span> <span class="leading-relaxed">$1</span></li>');
        
        const newChunk = `<!-- Point ${i} -->
          <div class="p-8 rounded-2xl bg-surface-900/30 border border-surface-800/60 relative overflow-hidden group hover:border-surface-700 transition-colors">
            <!-- Subtle gradient background -->
            <div class="absolute inset-0 bg-gradient-to-br from-surface-800/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
            
            <div class="relative">
              <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                <div>
                  <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-sm font-medium mb-3">
                    <span class="material-symbols-rounded text-primary" style="font-size:18px">${iconMatch[1]}</span>
                    ${category}
                  </div>
                  <h3 class="text-2xl font-bold text-white">${mainTitleMatch[1]}</h3>
                </div>
              </div>
              
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
                <!-- VS Badge -->
                <div class="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full border border-surface-700 bg-surface-900 items-center justify-center text-xs font-bold text-surface-400 z-10 shadow-xl">VS</div>
                
                <!-- Competitor Card -->
                <div class="bg-surface-800/20 rounded-xl p-6 border border-surface-700/50 relative overflow-hidden">
                  <div class="absolute top-0 right-0 w-32 h-32 bg-red-500/5 blur-[50px] -mr-16 -mt-16"></div>
                  <div class="relative">
                    <div class="flex items-center gap-2 mb-3">
                      <span class="material-symbols-rounded text-red-500/80" style="font-size:20px">error</span>
                      <h4 class="text-white font-semibold">${painTitleMatch[1]}</h4>
                    </div>
                    <p class="text-surface-400 text-sm leading-relaxed">${painTextMatch[1].trim()}</p>
                  </div>
                </div>

                <!-- Rebase Card -->
                <div class="bg-primary/5 rounded-xl p-6 border border-primary/20 relative overflow-hidden">
                  <div class="absolute top-0 right-0 w-32 h-32 bg-primary/10 blur-[50px] -mr-16 -mt-16"></div>
                  <div class="relative">
                    <div class="flex items-center gap-2 mb-3">
                      <span class="material-symbols-rounded text-primary" style="font-size:20px">check_circle</span>
                      <h4 class="text-white font-semibold">${solutionTitleMatch[1]}</h4>
                    </div>
                    <p class="text-surface-300 leading-relaxed text-sm mb-4">
                      ${solutionSummaryMatch[1].trim()}
                    </p>
                    <ul class="text-surface-400 space-y-3 text-sm">
                      ${ulContent.trim()}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>\n\n          `;
          
          content = content.replace(chunk, newChunk);
    } else {
        console.error(`Regex failed to match all groups for Point ${i} in ${file}`);
    }
  }

  fs.writeFileSync(filePath, content);
  console.log(`Successfully patched ${file}`);
}
