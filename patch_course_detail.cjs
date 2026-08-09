const fs = require('fs');
const file = 'src/pages/student/CourseDetailPage.tsx';
let code = fs.readFileSync(file, 'utf8');

// Add Sparkles import
code = code.replace(
  '  Play,',
  '  Play,\\n  Sparkles,'
);

// Add states for AI summary
const hookState = `  const [aiSummaryState, setAiSummaryState] = useState<'idle' | 'generating' | 'done'>('idle');
  const [aiSummaryData, setAiSummaryData] = useState<any>(null);

  useEffect(() => {
    setAiSummaryState('idle');
    setAiSummaryData(null);
  }, [activeLessonId]);

  const generateAiSummary = async () => {
    if (!selectedLesson || !course) return;
    try {
      setAiSummaryState('generating');
      const res = await fetch("/api/ai/summarize-lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseTitle: course.title,
          lessonTitle: selectedLesson.title,
          lessonContent: selectedLesson.summary || course.description,
        })
      });
      const data = await res.json();
      if (data && data.takeaways) {
        setAiSummaryData(data);
        setAiSummaryState('done');
      } else {
        setAiSummaryState('idle');
      }
    } catch (e) {
      alert("Lỗi AI tóm tắt.");
      setAiSummaryState('idle');
    }
  };`;

code = code.replace(
  "const completedLessonIds = progress?.completedLessonIds.length ? progress.completedLessonIds : fallbackCompletedIds",
  "const completedLessonIds = progress?.completedLessonIds.length ? progress.completedLessonIds : fallbackCompletedIds\n" + hookState
);

// Add AI Summary UI
const aiUI = `        {getAcademyCoachNote(selectedLesson) ? <div className="coach-notes-block"><NotebookPen size={17} /><div><strong>Ghi chú giảng viên</strong><p>{getAcademyCoachNote(selectedLesson)}</p></div></div> : null}
        
        {/* AI Summary Block */}
        <div style={{ marginTop: 24, padding: 20, borderRadius: 12, background: 'linear-gradient(to right, #f8fafc, #f1f5f9)', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
             <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
               <Sparkles size={18} color="#8b5cf6" />
               <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#334155' }}>AI Tổng hợp</h3>
             </div>
             {aiSummaryState === 'idle' && (
                <button className="primary-button" style={{ background: '#8b5cf6', borderColor: '#8b5cf6', fontSize: 12, padding: '6px 12px' }} onClick={generateAiSummary}>
                  Tạo Tóm Tắt & Thẻ Ghi Nhớ
                </button>
             )}
             {aiSummaryState === 'generating' && (
                <span style={{ fontSize: 12, color: '#64748b' }}>Đang phân tích...</span>
             )}
          </div>
          
          {aiSummaryState === 'done' && aiSummaryData && (
            <div>
              <div style={{ marginBottom: 16 }}>
                <strong style={{ fontSize: 13, color: '#475569', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Takeaways</strong>
                <ul style={{ paddingLeft: 20, margin: 0, color: '#334155', fontSize: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {aiSummaryData.takeaways?.map((item: string, idx: number) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong style={{ fontSize: 13, color: '#475569', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Key Concepts</strong>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {aiSummaryData.keyConcepts?.map((concept: any, idx: number) => (
                    <div key={idx} style={{ background: '#fff', padding: '10px 14px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                      <strong style={{ color: '#0f172a', display: 'block', fontSize: 14 }}>{concept.term}</strong>
                      <p style={{ margin: 0, color: '#64748b', fontSize: 13, marginTop: 4 }}>{concept.definition}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
`;

code = code.replace(
  "{getAcademyCoachNote(selectedLesson) ? <div className=\"coach-notes-block\"><NotebookPen size={17} /><div><strong>Ghi chú giảng viên</strong><p>{getAcademyCoachNote(selectedLesson)}</p></div></div> : null}",
  aiUI
);

fs.writeFileSync(file, code);
