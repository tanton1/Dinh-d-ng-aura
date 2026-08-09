const fs = require('fs');
const file = 'server.ts';
let code = fs.readFileSync(file, 'utf8');

const newEndpoint = `
  aiRouter.post("/summarize-lesson", async (req, res) => {
    try {
      const { lessonTitle, lessonContent, courseTitle } = req.body;
      const prompt = \`Hãy đóng vai một trợ lý học tập AI. Tóm tắt bài học sau đây thành các điểm chính (Takeaways) và các khái niệm quan trọng (Key Concepts).
Khóa học: "\${courseTitle}"
Tên bài học: "\${lessonTitle}"
Nội dung bài học: "\${lessonContent}"

Yêu cầu định dạng JSON chính xác:
{
  "takeaways": ["Điểm chính 1", "Điểm chính 2"],
  "keyConcepts": [
    { "term": "Khái niệm 1", "definition": "Định nghĩa ngắn gọn" }
  ]
}\`;

      const ai = getGenAI();
      if (!ai) {
        return res.status(500).json({ error: "Thiếu Gemini API Key" });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        }
      });
      res.json(JSON.parse(response.text));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Lỗi AI" });
    }
  });
`;

code = code.replace('  app.use("/api/ai", aiRouter);', newEndpoint + '\n  app.use("/api/ai", aiRouter);');
fs.writeFileSync(file, code);
