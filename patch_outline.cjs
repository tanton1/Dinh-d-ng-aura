const fs = require('fs');

const file = 'src/pages/admin/CourseEditorPage.tsx';
let code = fs.readFileSync(file, 'utf8');

const hookState = `  const [coverUploading, setCoverUploading] = useState(false)
  const coverInputRef = useRef<HTMLInputElement>(null)
  
  const [generatingOutline, setGeneratingOutline] = useState(false)
  const [generatingQuiz, setGeneratingQuiz] = useState(false)
  const [generatingMemory, setGeneratingMemory] = useState(false)

  const handleGenerateOutline = async () => {
    if (!course.title) {
      alert("Vui lòng nhập tên khóa học ở Bước 1 trước khi tự động lên sườn.");
      return;
    }
    if (course.modules.length > 0) {
      if (!window.confirm("Khóa học đã có chương. Việc tạo tự động có thể sẽ xóa hoặc ghi đè nội dung. Bạn có chắc chắn muốn tiếp tục?")) return;
    }
    try {
      setGeneratingOutline(true);
      const res = await fetch("/api/ai/generate-course-outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: course.title,
          audience: course.description || course.outcomes.join(', '),
          weeks: course.duration,
        })
      });
      const data = await res.json();
      if (data && data.modules) {
        setCourse((c) => ({
          ...c,
          modules: data.modules.map((m: any, i: number) => ({
            id: 'module-' + crypto.randomUUID(),
            title: m.title,
            lessons: m.lessons.map((l: any, j: number) => ({
              id: 'lesson-' + crypto.randomUUID(),
              type: "Video",
              title: l.title,
              duration: "5 phút",
              preview: false,
              summary: l.summary,
            }))
          }))
        }));
      }
    } catch (e) {
      alert("Có lỗi xảy ra khi gọi AI.");
    } finally {
      setGeneratingOutline(false);
    }
  }

  const handleGenerateQuiz = async () => {
    const detailLesson = course.modules[detailLessonModuleIndex]?.lessons[detailLessonIndex]
    if (!detailLesson) return;
    try {
      setGeneratingQuiz(true);
      const res = await fetch("/api/ai/generate-course-quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonTitle: detailLesson.title,
          lessonSummary: detailLesson.summary || detailLesson.coachNotes || course.title,
        })
      });
      const data = await res.json();
      if (data && data.questions) {
        setCourse((c) => {
          const newCourse = { ...c };
          const mod = newCourse.modules[detailLessonModuleIndex];
          const les = mod.lessons[detailLessonIndex];
          if (!les.quiz) {
            les.quiz = {
              questionOrder: 'sequential',
              passPercent: 70,
              publicSettings: { maxAttempts: 3, revealMode: 'after-submit' },
              questions: []
            };
          }
          les.quiz.questions = [
            ...(les.quiz.questions || []),
            ...data.questions.map((q: any) => ({
              id: 'quiz-' + crypto.randomUUID(),
              question: q.question,
              options: q.options,
              correctIndex: q.correctIndex,
              explanation: q.explanation
            }))
          ];
          return newCourse;
        });
      }
    } catch (e) {
      alert("Có lỗi xảy ra khi gọi AI Quiz.");
    } finally {
      setGeneratingQuiz(false);
    }
  }

  const handleGenerateMemory = async () => {
    const detailLesson = course.modules[detailLessonModuleIndex]?.lessons[detailLessonIndex]
    if (!detailLesson) return;
    try {
      setGeneratingMemory(true);
      const res = await fetch("/api/ai/generate-course-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonTitle: detailLesson.title,
          lessonSummary: detailLesson.summary || detailLesson.coachNotes || course.title,
        })
      });
      const data = await res.json();
      if (data) {
        setCourse((c) => {
          const newCourse = { ...c };
          const mod = newCourse.modules[detailLessonModuleIndex];
          const les = mod.lessons[detailLessonIndex];
          const existingMem = les.memory ? JSON.parse(les.memory) : { minuteSummary: '', keyTakeaways: [], terms: [], recallPrompts: [], flashcards: [] };
          
          const newMem = {
             minuteSummary: data.minuteSummary || existingMem.minuteSummary,
             keyTakeaways: [...(existingMem.keyTakeaways||[]), ...(data.keyTakeaways||[])],
             terms: [...(existingMem.terms||[]), ...(data.terms||[]).map((t:any) => ({ id: crypto.randomUUID(), ...t }))],
             recallPrompts: [...(existingMem.recallPrompts||[]), ...(data.recallPrompts||[]).map((r:any) => ({ id: crypto.randomUUID(), ...r }))],
             flashcards: [...(existingMem.flashcards||[]), ...(data.flashcards||[]).map((f:any) => ({ id: crypto.randomUUID(), ...f }))]
          };
          
          les.memory = JSON.stringify(newMem);
          return newCourse;
        });
      }
    } catch (e) {
      alert("Có lỗi xảy ra khi gọi AI Flashcard.");
    } finally {
      setGeneratingMemory(false);
    }
  }
`;

code = code.replace('  const [coverUploading, setCoverUploading] = useState(false)\n  const coverInputRef = useRef<HTMLInputElement>(null)', hookState);

const outlineButton = `<div className="builder-heading"><div><span className="eyebrow">BƯỚC 2 / 4</span><h1>Nội dung Aura Academy</h1><p>Thiết kế khóa đào tạo dinh dưỡng chuyên sâu, độc lập hoàn toàn với giáo án PT.</p></div><div style={{display: 'flex', gap: 8}}><button className="outline-button" onClick={handleGenerateOutline} disabled={generatingOutline} style={{color: '#8b5cf6', borderColor: '#8b5cf6'}}><Sparkles size={17} /> {generatingOutline ? 'Đang tạo...' : 'AI Lên sườn nội dung'}</button><button className="outline-button" onClick={addModule}><Plus size={17} /> Thêm chương</button></div></div>`;
code = code.replace('<div className="builder-heading"><div><span className="eyebrow">BƯỚC 2 / 4</span><h1>Nội dung Aura Academy</h1><p>Thiết kế khóa đào tạo dinh dưỡng chuyên sâu, độc lập hoàn toàn với giáo án PT.</p></div><button className="outline-button" onClick={addModule}><Plus size={17} /> Thêm chương</button></div>', outlineButton);

const quizButton = `<div className="builder-quiz-head" style={{marginTop: 16, borderTop: '1px solid #e2e8f0', paddingTop: 16}}>
                            <button className="outline-button" onClick={handleGenerateQuiz} disabled={generatingQuiz} style={{color: '#8b5cf6', borderColor: '#8b5cf6'}}><Sparkles size={14} /> {generatingQuiz ? 'Đang tạo...' : 'AI Tạo câu hỏi'}</button>
                          </div>
                          {(detailLesson.quiz?.questions ?? [])`;
code = code.replace('{(detailLesson.quiz?.questions ?? [])', quizButton);

const memoryButton = `<AcademyLessonMemoryEditor
                            content={
                              hasAcademyLessonContent(detailLesson)
                                ? getAcademyLessonContent(detailLesson)
                                : { minuteSummary: '', keyTakeaways: [], terms: [], recallPrompts: [], flashcards: [] }
                            }
                            onChange={(content) => {
                              updateLesson(detailLessonModuleIndex, detailLessonIndex, { memory: toAcademyLessonMemory(content) })
                            }}
                          />
                          <div style={{marginTop: 16, display: 'flex', justifyContent: 'flex-end'}}>
                            <button className="outline-button" onClick={handleGenerateMemory} disabled={generatingMemory} style={{color: '#8b5cf6', borderColor: '#8b5cf6'}}><Sparkles size={14} /> {generatingMemory ? 'Đang tạo...' : 'AI Tạo Flashcard & Active Recall'}</button>
                          </div>`;
code = code.replace(`<AcademyLessonMemoryEditor
                            content={
                              hasAcademyLessonContent(detailLesson)
                                ? getAcademyLessonContent(detailLesson)
                                : { minuteSummary: '', keyTakeaways: [], terms: [], recallPrompts: [], flashcards: [] }
                            }
                            onChange={(content) => {
                              updateLesson(detailLessonModuleIndex, detailLessonIndex, { memory: toAcademyLessonMemory(content) })
                            }}
                          />`, memoryButton);

fs.writeFileSync(file, code);
