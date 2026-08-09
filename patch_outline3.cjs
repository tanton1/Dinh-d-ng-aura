const fs = require('fs');
const file = 'src/pages/admin/CourseEditorPage.tsx';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  'les.quiz.questions = [',
  'les.quiz!.questions = ['
);
code = code.replace(
  '...(les.quiz.questions || []),',
  '...(les.quiz!.questions || []),'
);

code = code.replace(
  "const existingContent = hasAcademyLessonContent(les) ? getAcademyLessonContent(les) : { minuteSummary: '', keyTakeaways: [], terms: [], recallPrompts: [], flashcards: [] };",
  "const existingContent = getAcademyLessonContent(les);"
);

fs.writeFileSync(file, code);
