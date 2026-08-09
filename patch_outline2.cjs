const fs = require('fs');
const file = 'src/pages/admin/CourseEditorPage.tsx';
let code = fs.readFileSync(file, 'utf8');

// Fix quiz draft missing id
code = code.replace(
  "les.quiz = {\\n              questionOrder: 'sequential',",
  "les.quiz = {\\n              id: crypto.randomUUID(),\\n              questionOrder: 'sequential',"
);

// Fix memory generation
const oldMemoryCode = `          const existingMem = les.memory ? JSON.parse(les.memory) : { minuteSummary: '', keyTakeaways: [], terms: [], recallPrompts: [], flashcards: [] };
          
          const newMem = {
             minuteSummary: data.minuteSummary || existingMem.minuteSummary,
             keyTakeaways: [...(existingMem.keyTakeaways||[]), ...(data.keyTakeaways||[])],
             terms: [...(existingMem.terms||[]), ...(data.terms||[]).map((t:any) => ({ id: crypto.randomUUID(), ...t }))],
             recallPrompts: [...(existingMem.recallPrompts||[]), ...(data.recallPrompts||[]).map((r:any) => ({ id: crypto.randomUUID(), ...r }))],
             flashcards: [...(existingMem.flashcards||[]), ...(data.flashcards||[]).map((f:any) => ({ id: crypto.randomUUID(), ...f }))]
          };
          
          les.memory = JSON.stringify(newMem);`;

const newMemoryCode = `          const existingContent = hasAcademyLessonContent(les) ? getAcademyLessonContent(les) : { minuteSummary: '', keyTakeaways: [], terms: [], recallPrompts: [], flashcards: [] };
          
          const newContent = {
             minuteSummary: data.minuteSummary || existingContent.minuteSummary,
             keyTakeaways: [...(existingContent.keyTakeaways||[]), ...(data.keyTakeaways||[])],
             terms: [...(existingContent.terms||[]), ...(data.terms||[]).map((t:any) => ({ id: crypto.randomUUID(), term: t.term, definition: t.definition }))],
             recallPrompts: [...(existingContent.recallPrompts||[]), ...(data.recallPrompts||[]).map((r:any) => ({ id: crypto.randomUUID(), prompt: r.prompt, answer: r.answer }))],
             flashcards: [...(existingContent.flashcards||[]), ...(data.flashcards||[]).map((f:any) => ({ id: crypto.randomUUID(), front: f.front, back: f.back, hint: f.hint }))]
          };
          
          les.memory = toAcademyLessonMemory(newContent);`;

code = code.replace(oldMemoryCode, newMemoryCode);

fs.writeFileSync(file, code);
