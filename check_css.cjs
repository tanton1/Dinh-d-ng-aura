const fs = require('fs');
const glob = require('glob'); // Not available, let's just use standard fs.readdirSync
const path = require('path');

function checkFile(file) {
  const content = fs.readFileSync(file, 'utf-8');
  let openCount = 0;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      if (line[j] === '{') openCount++;
      if (line[j] === '}') {
        openCount--;
        if (openCount < 0) {
          console.log(`Unbalanced '}' found in ${file} at line ${i + 1}`);
          openCount = 0; // reset to find multiple
        }
      }
    }
  }
  if (openCount > 0) {
    console.log(`Unbalanced '{' found in ${file}: ${openCount} unclosed brackets.`);
  }
}

const files = fs.readdirSync('src').filter(f => f.endsWith('.css'));
for (const file of files) {
  checkFile(path.join('src', file));
}
