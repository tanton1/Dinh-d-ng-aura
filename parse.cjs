const fs = require('fs')
const ts = require('typescript')

const code = fs.readFileSync('src/components/progress/ProgressPhotosCard.tsx', 'utf-8')
const sourceFile = ts.createSourceFile('ProgressPhotosCard.tsx', code, ts.ScriptTarget.Latest, true)
console.log(sourceFile.parseDiagnostics)
