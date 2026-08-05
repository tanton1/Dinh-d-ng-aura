import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '15mb' }));

  // Helper to initialize GenAI with User-Agent header
  const getGenAI = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  };

  app.post("/api/generateMealReview", async (req, res) => {
    try {
      const { meal, userProfile } = req.body;
      const ai = getGenAI();
      if (!ai) {
        return res.status(500).json({ review: 'Cần cấu hình Gemini API Key trên máy chủ để AI có thể phân tích.' });
      }

      const prompt = `Đóng vai một chuyên gia dinh dưỡng PT Aura Fitness khắt khe nhưng động viên.
Phân tích bữa ăn sau đây của học viên:
- Tên món: ${meal?.title || meal?.label || 'Không rõ'}
- Kcal: ${meal?.calories || 0}
- Đạm: ${meal?.protein || 0}g, Bột đường: ${meal?.carbs || 0}g, Béo: ${meal?.fat || 0}g
Mục tiêu của học viên: ${userProfile?.goals?.includes('lose-fat') ? 'Giảm mỡ' : userProfile?.goals?.includes('gain-muscle') ? 'Tăng cơ' : 'Duy trì vóc dáng'}
Hãy viết một nhận xét ngắn gọn (khoảng 2-3 câu), chỉ ra điểm tốt và điểm cần cải thiện của bữa ăn này dựa trên mục tiêu của họ. KHÔNG dùng markdown hay định dạng phức tạp. Viết trực tiếp nội dung.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: prompt,
        config: {
          maxOutputTokens: 500,
        }
      });

      res.json({ review: response.text || 'Không thể phân tích bữa ăn lúc này.' });
    } catch (e) {
      console.error('Failed to generate meal review', e);
      res.status(500).json({ review: 'Lỗi khi gọi AI phân tích bữa ăn.' });
    }
  });

  // AI Meal Analysis endpoint using Gemini 3.6 Flash Vision
  app.post("/api/ai/analyze-meal", async (req, res) => {
    try {
      const { imageBase64, imageUrl, studentNote, studentGoal, studentCondition } = req.body;
      const ai = getGenAI();
      if (!ai) {
        return res.status(500).json({
          success: false,
          error: "Thiếu GEMINI_API_KEY trên server."
        });
      }

      const parts: any[] = [];

      // Check if imageBase64 is passed
      if (imageBase64 && typeof imageBase64 === 'string') {
        const match = imageBase64.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (match) {
          parts.push({
            inlineData: {
              mimeType: match[1],
              data: match[2]
            }
          });
        }
      } else if (imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('data:')) {
        const match = imageUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (match) {
          parts.push({
            inlineData: {
              mimeType: match[1],
              data: match[2]
            }
          });
        }
      }

      const promptText = `Bạn là hệ thống AI Aura Nutrition & Chuyên gia Dinh dưỡng PT hàng đầu.
Nhiệm vụ: Nhận diện hình ảnh món ăn (nếu có) kết hợp với ghi chú và hồ sơ cá nhân của học viên để phân tích dinh dưỡng chuẩn xác.

Thông tin học viên:
- Ghi chú bữa ăn từ học viên: "${studentNote || 'Không có ghi chú'}"
- Mục tiêu học viên: "${studentGoal || 'Tăng cơ, siết mỡ'}"
- Thể trạng & Hồ sơ học viên: "${studentCondition || 'Nữ, 55kg, BMR 1200 kcal'}"

Yêu cầu phân tích chi tiết:
1. items: Danh sách các thực phẩm cấu thành bữa ăn (tên món tiếng Việt, khối lượng ước tính gram, kcal, đạm/protein gram).
2. totalKcal & totalProtein: Tổng năng lượng (kcal) và tổng đạm (g) của toàn bộ bữa ăn.
3. quantityAndCookingAnalysis: Phân tích chi tiết về định lượng thực tế quan sát được (VD: khoảng 150g cơm trắng, 120g ức gà áp chảo...) và nhận định cụ thể về phương pháp chế biến (luộc, hấp, chiên xù, xào nhiều dầu, áp chảo, nướng...).
4. portionAndCalorieRationale: Giải thích rõ ràng cơ sở/căn cứ để dự đoán khối lượng và số Kcal đó (dựa trên kích thước bát/đĩa tương quan, độ dày miếng thịt, lượng dầu mỡ/sốt phủ).
5. goalAlignmentAssessment: Nhận định ngắn gọn, súc tích về bữa ăn này so với mục tiêu cụ thể của khách hàng (VD: "Bữa ăn đáp ứng rất tốt lượng đạm cho mục tiêu tăng cơ, tuy nhiên lượng calo hơi cao so với mức thâm hụt mong muốn...").
6. coachFeedbackSuggestion: Lời khuyên/gợi ý phản hồi chi tiết dành riêng cho Coach để gửi khách hàng (BẮT BUỘC độ dài từ 30 - 100 từ). Ngôn từ vừa chuẩn chuyên môn dinh dưỡng/PT, vừa gần gũi, ấm áp, truyền động lực. Phân tích rõ tỉ lệ đạm, cách chế biến và đưa ra giải pháp thực tế để học viên thực hiện dựa trên mục tiêu & hồ sơ của học viên.`;

      parts.push({ text: promptText });

      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              items: {
                type: Type.ARRAY,
                description: "Danh sách thực phẩm cấu thành bữa ăn",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING, description: "Tên thực phẩm (Tiếng Việt)" },
                    weight: { type: Type.NUMBER, description: "Khối lượng ước tính (g)" },
                    kcal: { type: Type.NUMBER, description: "Năng lượng (kcal)" },
                    protein: { type: Type.NUMBER, description: "Lượng đạm (g)" }
                  },
                  required: ["name", "weight", "kcal", "protein"]
                }
              },
              totalKcal: { type: Type.NUMBER, description: "Tổng Kcal bữa ăn" },
              totalProtein: { type: Type.NUMBER, description: "Tổng Protein bữa ăn (g)" },
              quantityAndCookingAnalysis: { type: Type.STRING, description: "Phân tích chi tiết về định lượng và nhận định chế biến" },
              portionAndCalorieRationale: { type: Type.STRING, description: "Cơ sở dự đoán khối lượng và Kcal" },
              goalAlignmentAssessment: { type: Type.STRING, description: "Nhận định ngắn gọn về bữa ăn so với mục tiêu khách hàng" },
              aiFeedback: { type: Type.STRING, description: "Nhận định tổng quan về dinh dưỡng" },
              coachFeedbackSuggestion: { type: Type.STRING, description: "Lời khuyên gần gũi từ Coach dành riêng cho học viên" }
            },
            required: ["items", "totalKcal", "totalProtein", "quantityAndCookingAnalysis", "portionAndCalorieRationale", "goalAlignmentAssessment", "aiFeedback", "coachFeedbackSuggestion"]
          }
        }
      });

      const responseText = response.text || '';
      const parsedData = JSON.parse(responseText);

      res.json({
        success: true,
        analysis: parsedData
      });
    } catch (e: any) {
      console.error('Failed in /api/ai/analyze-meal:', e);
      res.status(500).json({
        success: false,
        error: e?.message || 'Lỗi xử lý AI'
      });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
