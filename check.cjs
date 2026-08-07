const fs = require('fs')
const content = fs.readFileSync('src/components/progress/ProgressPhotosCard.tsx', 'utf-8')
console.log(content.substring(content.lastIndexOf('}'), content.length))
