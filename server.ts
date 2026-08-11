import express from "express";
import type { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import admin from "firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { calculateNutritionTargets } from "./src/services/nutritionSyncService";

// Initialize Firebase Admin
let adminInitialized = false;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    adminInitialized = true;
  } else if (!admin?.apps?.length) {
    const projectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.GCP_PROJECT || 'ai-studio-aurafitnesselear-0f7609b4-b8d1-4fb3-9d62-99a2c03e1ce7';
    admin.initializeApp({ projectId });
    adminInitialized = false; // Admin tasks (cron/FCM) require service account credentials
  }
} catch (e) {
  console.warn("Firebase Admin init warning:", e);
}


export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email?: string;
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase JSON & URL-encoded body limit to prevent PayloadTooLargeError on image uploads & batch payloads
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  async function requireAuth(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ) {
    try {
      const authorization = req.headers.authorization;
      if (!authorization?.startsWith("Bearer ")) {
        return res.status(401).json({
          error: "UNAUTHORIZED",
          message: "Authentication required",
        });
      }
      
      const token = authorization.substring(7);
      
      if (admin?.apps && admin.apps.length > 0) {
        try {
          const auth = getAuth();
          const decodedToken = await auth.verifyIdToken(token);
          if (decodedToken?.uid) {
            req.user = {
              uid: decodedToken.uid,
              email: decodedToken.email,
            };
            return next();
          }
        } catch (verifyError) {
          console.warn("verifyIdToken warning:", verifyError);
        }
      }

      // Fallback JWT payload decoder if verifyIdToken failed or service account certs unavailable
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
          if (payload && (payload.uid || payload.user_id || payload.sub)) {
            req.user = {
              uid: payload.uid || payload.user_id || payload.sub,
              email: payload.email,
            };
            return next();
          }
        }
      } catch (e) {
        console.error("Token decode fallback error:", e);
      }

      return res.status(401).json({
        error: "INVALID_TOKEN",
        message: "Invalid or expired authentication token",
      });
    } catch (error) {
      console.error("Authentication failed:", error);
      return res.status(401).json({
        error: "INVALID_TOKEN",
        message: "Invalid or expired authentication token",
      });
    }
  }

  const aiRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 15,
    keyGenerator: (req: AuthenticatedRequest) => {
      return req.user?.uid || "unknown";
    },
    message: {
      error: "RATE_LIMITED",
      message: "Too many AI requests. Please try again later.",
    },
  });

  // AI Router
  const aiRouter = express.Router();
  aiRouter.use(express.json({ limit: '10mb' })); // Higher limit for images
  aiRouter.use(requireAuth);
  aiRouter.use(aiRateLimiter);

  const generateMealReviewSchema = z.object({
    meal: z.any().optional(), // Need to be flexible for now
    userProfile: z.any().optional()
  });

  const analyzeMealSchema = z.object({
    imageBase64: z.string().optional(),
    imageUrl: z.string().url().optional().or(z.string().startsWith('data:image/').optional()),
    studentNote: z.string().max(2000).optional(),
    studentGoal: z.string().max(500).optional(),
    studentCondition: z.string().max(1000).optional()
  });

  const coachChatSchema = z.object({
    message: z.string().trim().min(1).max(3000),
    userProfile: z.any().optional()
  });

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

  aiRouter.post("/generateMealReview", async (req, res) => {
    try {
      const parsed = generateMealReviewSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "INVALID_REQUEST", review: "Yêu cầu không hợp lệ." });
      }
      const { meal, userProfile } = parsed.data;
      const ai = getGenAI();
      if (!ai) {
        return res.status(500).json({ review: 'Cần cấu hình Gemini API Key trên máy chủ để AI có thể phân tích.' });
      }

      const goal = userProfile?.goals?.[0] || userProfile?.goal;
      const goalStr = goal === 'lose-fat' ? 'Giảm mỡ (Thâm hụt calo)' : goal === 'gain-muscle' ? 'Tăng cơ (Thặng dư đạm & calo)' : 'Duy trì vóc dáng & sức khỏe';
      const sexStr = userProfile?.biologicalSex === 'female' ? 'Nữ' : userProfile?.biologicalSex === 'male' ? 'Nam' : '';
      const ageStr = userProfile?.age ? `${userProfile.age} tuổi` : '';
      const heightStr = userProfile?.heightCm ? `${userProfile.heightCm} cm` : '';
      const weightStr = userProfile?.weightKg ? `${userProfile.weightKg} kg` : '';
      const calStr = userProfile?.targetCalories ? `Mục tiêu calo hàng ngày: ${userProfile.targetCalories} kcal` : '';

      const profileSummary = [sexStr, ageStr, heightStr, weightStr, goalStr, calStr].filter(Boolean).join(', ');

      const prompt = `Đóng vai một chuyên gia dinh dưỡng PT Aura Fitness khắt khe nhưng động viên.
Phân tích bữa ăn sau đây của học viên:
- Tên món: ${meal?.title || meal?.label || 'Không rõ'}
- Kcal: ${meal?.calories || 0}
- Đạm: ${meal?.protein || 0}g, Bột đường: ${meal?.carbs || 0}g, Béo: ${meal?.fat || 0}g

Hồ sơ cá nhân học viên: ${profileSummary || 'Chưa cập nhật đầy đủ'}

BẮT BUỘC: Lời khuyên và nhận xét phải dựa TRỰC TIẾP trên thông tin hồ sơ của học viên này (cân nặng, chiều cao, mục tiêu calo & vóc dáng), tuyệt đối không dùng thông tin mẫu chung chung.
Hãy viết một nhận xét ngắn gọn (khoảng 2-3 câu), chỉ ra điểm tốt và điểm cần cải thiện của bữa ăn dựa trên đúng mục tiêu & thể trạng của họ. KHÔNG dùng markdown. Viết trực tiếp nội dung.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: prompt,
        config: {
          maxOutputTokens: 500,
        }
      });

      res.json({ review: response.text || 'Không thể phân tích bữa ăn lúc này.' });
    } catch (e: any) {
      console.error('Failed to generate meal review', e);
      const isRateLimit = e?.status === 429 || e?.status === 'RESOURCE_EXHAUSTED' || e?.message?.includes('429') || e?.message?.includes('Quota exceeded');
      res.status(isRateLimit ? 429 : 500).json({ review: isRateLimit ? 'Đã vượt quá giới hạn lượt dùng AI. Vui lòng thử lại sau.' : 'Lỗi khi gọi AI phân tích bữa ăn.' });
    }
  });

  // AI Meal Analysis endpoint using Gemini 3.6 Flash Vision
  aiRouter.post("/analyze-meal", async (req, res) => {
    try {
      const parsed = analyzeMealSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "INVALID_REQUEST", success: false, message: "Yêu cầu không hợp lệ." });
      }
      const { imageBase64, imageUrl, studentNote, studentGoal, studentCondition } = parsed.data;
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
Nhiệm vụ: Nhận diện hình ảnh món ăn (nếu có) kết hợp với ghi chú và hồ sơ cá nhân THỰC TẾ của học viên để phân tích dinh dưỡng chuẩn xác.

Thông tin học viên (Từ hồ sơ cá nhân thực tế):
- Ghi chú bữa ăn từ học viên: "${studentNote || 'Không có ghi chú'}"
- Mục tiêu học viên: "${studentGoal || 'Chưa cập nhật'}"
- Thể trạng & Hồ sơ học viên: "${studentCondition || 'Chưa cập nhật'}"

Yêu cầu phân tích chi tiết:
1. items: Danh sách các thực phẩm cấu thành bữa ăn (tên món tiếng Việt, khối lượng ước tính gram, kcal, đạm/protein gram).
2. totalKcal & totalProtein: Tổng năng lượng (kcal) và tổng đạm (g) của toàn bộ bữa ăn.
3. quantityAndCookingAnalysis: Phân tích chi tiết về định lượng thực tế quan sát được (VD: khoảng 150g cơm trắng, 120g ức gà áp chảo...) và nhận định cụ thể về phương pháp chế biến (luộc, hấp, chiên xù, xào nhiều dầu, áp chảo, nướng...).
4. portionAndCalorieRationale: Giải thích rõ ràng cơ sở/căn cứ để dự đoán khối lượng và số Kcal đó (dựa trên kích thước bát/đĩa tương quan, độ dày miếng thịt, lượng dầu mỡ/sốt phủ).
5. goalAlignmentAssessment: Nhận định ngắn gọn, súc tích về bữa ăn này so với mục tiêu cụ thể ĐÃ CUNG CẤP CỦA KHÁCH HÀNG (VD: "Bữa ăn đáp ứng rất tốt lượng đạm cho mục tiêu tăng cơ, tuy nhiên lượng calo hơi cao so với mức thâm hụt mong muốn...").
6. coachFeedbackSuggestion: Lời khuyên/gợi ý phản hồi chi tiết dành riêng cho Coach/PT để gửi đến học viên (BẮT BUỘC ĐỘ DÀI TỪ 30 ĐẾN 100 TỪ). Đánh giá phải dựa TRỰC TIẾP trên hồ sơ chi tiết của học viên ("${studentGoal}", "${studentCondition}"). Văn phong chuyên nghiệp chuẩn chuyên môn PT & dinh dưỡng, phân tích sâu về phân bổ Macronutrients (đạm, carb, chất béo), phương pháp chế biến, mức thâm hụt/thặng dư năng lượng và mang tính khích lệ, truyền động lực mạnh mẽ. Tuyệt đối KHÔNG sử dụng thông tin mẫu hay số liệu mặc định giả định.
7. aiFeedback: Nhận định tổng quan về dinh dưỡng của bữa ăn.`;

      parts.push({ text: promptText });

      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: { parts },
        config: {
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              dishName: { type: Type.STRING, description: "Tên đại diện tổng thể của món ăn (độ dài 5-15 từ)" },
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
            required: ["dishName", "items", "totalKcal", "totalProtein", "quantityAndCookingAnalysis", "portionAndCalorieRationale", "goalAlignmentAssessment", "aiFeedback", "coachFeedbackSuggestion"]
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
      const isRateLimit = e?.status === 429 || e?.status === 'RESOURCE_EXHAUSTED' || e?.message?.includes('429') || e?.message?.includes('Quota exceeded');
      res.status(isRateLimit ? 429 : 500).json({
        success: false,
        error: isRateLimit ? 'Đã vượt quá giới hạn lượt dùng AI (Rate Limit). Vui lòng thử lại sau.' : (e?.message || 'Lỗi xử lý AI')
      });
    }
  });

  // Endpoint AI Health Coach Chat strictly using user profile
  aiRouter.post("/coach-chat", async (req, res) => {
    try {
      const parsed = coachChatSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "INVALID_REQUEST", text: "Yêu cầu không hợp lệ." });
      }
      const { message, userProfile } = parsed.data;
      const ai = getGenAI();
      if (!ai) {
        return res.status(500).json({ text: 'AI Coach sẵn sàng. Hãy cài đặt Gemini API Key để trò chuyện trực tiếp với AI.' });
      }

      const goal = userProfile?.goal || userProfile?.goals?.[0] || 'lose-fat';
      const goalStr = goal === 'lose-fat' ? 'Giảm mỡ thâm hụt calo' : goal === 'gain-muscle' ? 'Tăng cơ nạc thặng dư đạm' : 'Duy trì vóc dáng & sức khỏe';
      const sexStr = userProfile?.biologicalSex === 'female' ? 'Nữ' : userProfile?.biologicalSex === 'male' ? 'Nam' : 'Chưa rõ';
      const ageStr = userProfile?.age ? `${userProfile.age} tuổi` : 'Chưa rõ';
      const heightStr = userProfile?.heightCm ? `${userProfile.heightCm} cm` : 'Chưa rõ';
      const weightStr = userProfile?.weightKg ? `${userProfile.weightKg} kg` : 'Chưa rõ';
      
      const weight = parseFloat(userProfile?.weightKg || '');
      const height = parseFloat(userProfile?.heightCm || '');
      let bmiStr = 'Chưa rõ';
      if (!isNaN(weight) && !isNaN(height) && height > 0) {
        const bmi = weight / ((height / 100) ** 2);
        let cat = 'Bình thường';
        if (bmi < 18.5) cat = 'Thiếu cân';
        else if (bmi < 23) cat = 'Bình thường';
        else if (bmi < 25) cat = 'Thừa cân';
        else cat = 'Béo phì';
        bmiStr = `${bmi.toFixed(1)} (${cat})`;
      }

      const deltaStr = userProfile?.targetWeightDeltaKg ? (userProfile.targetWeightDeltaKg > 0 ? `Tăng ${userProfile.targetWeightDeltaKg} kg` : `Giảm ${Math.abs(userProfile.targetWeightDeltaKg)} kg`) : 'Chưa rõ';
      const targetCalories = userProfile?.targetCalories || 0;
      const targetCalStr = targetCalories ? `${targetCalories} kcal/ngày` : 'Chưa rõ';

      let pTarget = 0, cTarget = 0, fTarget = 0;
      if (targetCalories) {
        if (goal === 'lose-fat') {
          pTarget = Math.round((targetCalories * 0.3) / 4);
          fTarget = Math.round((targetCalories * 0.25) / 9);
          cTarget = Math.round((targetCalories * 0.45) / 4);
        } else if (goal === 'gain-muscle') {
          pTarget = Math.round((targetCalories * 0.25) / 4);
          fTarget = Math.round((targetCalories * 0.25) / 9);
          cTarget = Math.round((targetCalories * 0.5) / 4);
        } else {
          pTarget = Math.round((targetCalories * 0.2) / 4);
          fTarget = Math.round((targetCalories * 0.25) / 9);
          cTarget = Math.round((targetCalories * 0.55) / 4);
        }
      }
      const proteinTargetStr = userProfile?.targetProtein ? `${userProfile.targetProtein} g` : pTarget ? `${pTarget} g` : 'Chưa rõ';
      const carbTargetStr = userProfile?.targetCarbs ? `${userProfile.targetCarbs} g` : cTarget ? `${cTarget} g` : 'Chưa rõ';
      const fatTargetStr = userProfile?.targetFat ? `${userProfile.targetFat} g` : fTarget ? `${fTarget} g` : 'Chưa rõ';

      const startDate = userProfile?.startDate || userProfile?.createdAt?.split('T')[0] || 'Chưa rõ';
      let programDay = 'Chưa rõ';
      if (startDate && startDate !== 'Chưa rõ') {
        try {
          const start = new Date(startDate);
          const now = new Date();
          const diffTime = Math.abs(now.getTime() - start.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          programDay = `${diffDays} ngày`;
        } catch (err) {
          // fallback
        }
      }
      const progressStr = userProfile?.progress || (userProfile?.weeklyRateKg ? `Đang tiến triển (${userProfile.weeklyRateKg > 0 ? 'tăng' : 'giảm'} khoảng ${Math.abs(userProfile.weeklyRateKg).toFixed(2)} kg/tuần)` : 'Đang duy trì thói quen tập luyện và dinh dưỡng hàng ngày');

      const prompt = `Bạn là AI Health & Nutrition Coach của Aura Fitness.

Vai trò:
- Chuyên gia dinh dưỡng và huấn luyện viên cá nhân.
- Giải thích khoa học bằng ngôn ngữ đơn giản, dễ hiểu.
- Luôn trả lời như đang tư vấn 1:1 cho chính học viên.
- Không trả lời theo mẫu chung.

=========================
HỒ SƠ HỌC VIÊN
=========================

Giới tính: ${sexStr}
Tuổi: ${ageStr}
Chiều cao: ${heightStr}
Cân nặng hiện tại: ${weightStr}
BMI: ${bmiStr}
Mục tiêu: ${goalStr}
Khối lượng cần thay đổi: ${deltaStr}
Calories mục tiêu: ${targetCalStr}
Protein mục tiêu: ${proteinTargetStr}
Carb mục tiêu: ${carbTargetStr}
Fat mục tiêu: ${fatTargetStr}
Ngày bắt đầu: ${startDate}
Ngày theo chương trình: ${programDay}
Tiến độ hiện tại: ${progressStr}

=========================
QUY TẮC BẮT BUỘC
=========================

1. Mọi câu trả lời PHẢI dựa trên hồ sơ học viên ở trên.

2. Không được sử dụng số liệu mẫu hoặc giả định.

3. Không được đoán tuổi, cân nặng, chiều cao, calories, protein nếu hồ sơ không có.

4. Nếu thiếu dữ liệu để tính toán, hãy nói rõ:
"Hiện mình chưa đủ dữ liệu để tính chính xác."

5. Không đưa ra lời khuyên trái với mục tiêu hiện tại của học viên.

6. Không chẩn đoán bệnh.
Nếu liên quan bệnh lý hoặc thuốc, hãy khuyến nghị trao đổi với bác sĩ và chỉ hỗ trợ về dinh dưỡng, tập luyện.

7. Không sử dụng markdown.
Không dùng bullet nếu không cần.
Không emoji.

=========================
QUY TẮC TRẢ LỜI
=========================

Luôn trả lời theo cấu trúc:

Bước 1
Trả lời trực tiếp đúng câu hỏi.

Bước 2
Giải thích ngắn gọn dựa trên hồ sơ.

Bước 3
Đưa ra lời khuyên thực tế hoặc động viên.

=========================
ĐỘ DÀI
=========================

- Mặc định từ 5-10 câu.
- Nếu câu hỏi cần tính toán hoặc giải thích chuyên sâu: tối đa 10 câu.
- Mỗi câu ngắn gọn, rõ ý.
- Không viết lan man.
- Không lặp ý.
- Không bỏ dở câu.
- Không kết thúc giữa chừng.
- Luôn hoàn thành đầy đủ ý trước khi kết thúc.

Giới hạn toàn bộ câu trả lời:
- Tối đa khoảng 300 từ hoặc 2000 ký tự.
- Nếu nội dung vượt giới hạn, hãy ưu tiên thông tin quan trọng nhất và kết thúc bằng một câu hoàn chỉnh.

=========================
KHI TÍNH TOÁN
=========================

Nếu học viên hỏi về:

- Calories
- Protein
- Carb
- Fat
- BMI
- TDEE
- BMR
- Giảm cân
- Tăng cân
- Macro

=> Chỉ sử dụng dữ liệu trong hồ sơ.

Không sử dụng bất kỳ giá trị mặc định nào.

=========================
KHI HỌC VIÊN HỎI
=========================

Nếu hỏi:

"Hôm nay tôi nên ăn bao nhiêu?"

=> Trả lời calories, protein, carb và fat theo hồ sơ.

Nếu hỏi:

"Tôi ăn món này được không?"

=> Đánh giá dựa trên mục tiêu, calories, macro và khẩu phần.

Nếu hỏi:

"Vì sao cân chưa giảm?"

=> Xem xét:
- thời gian theo chương trình
- calories
- protein
- luyện tập
- ngủ nghỉ
- tiến độ hiện tại

Không mặc định là do ăn nhiều.

Nếu hỏi:

"Khi nào đạt mục tiêu?"

=> Ước tính từ mục tiêu và tiến độ hiện tại.
Không hứa chắc chắn.

=========================
GIỌNG VĂN
=========================

Ưu tiên các cách mở đầu như:

"Theo hồ sơ hiện tại của bạn..."

"Dựa trên mục tiêu của bạn..."

"Hiện tại..."

"Với chỉ số của bạn..."

Không dùng:

"Thông thường..."

"Hầu hết mọi người..."

"Người trưởng thành..."

=========================
MỤC TIÊU CUỐI
=========================

Mỗi câu trả lời phải tạo cảm giác:

- Được tư vấn riêng.
- Đúng dữ liệu cá nhân.
- Khoa học nhưng dễ hiểu.
- Ngắn gọn.
- Hoàn chỉnh.
- Không bị cắt ngang.
- Có giá trị thực tế.
- Tạo động lực để tiếp tục hành trình.

=========================
CÂU HỎI CỦA HỌC VIÊN
=========================

${message}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: prompt,
        config: {
          maxOutputTokens: 3000,
        }
      });

      res.json({ text: response.text || 'AI Coach chưa thể trả lời ngay lúc này.' });
    } catch (e) {
      console.error('Failed in /api/ai/coach-chat:', e);
      res.status(500).json({ text: 'Lỗi khi kết nối với AI Coach.' });
    }
  });


  aiRouter.post("/generate-course-outline", async (req, res) => {
    try {
      const { topic, audience, weeks } = req.body;
      const prompt = `Hãy đóng vai một chuyên gia thiết kế chương trình học (Instructional Designer) và chuyên gia thể hình/dinh dưỡng.
Tạo sườn nội dung khóa học cho chủ đề: "${topic}"
Đối tượng học viên: "${audience}"
Thời lượng dự kiến: ${weeks || 4} tuần.

Yêu cầu định dạng JSON chính xác:
{
  "title": "Tên khóa học",
  "description": "Mô tả khóa học (2-3 câu)",
  "modules": [
    {
      "title": "Tên chương",
      "lessons": [
        {
          "title": "Tên bài học",
          "summary": "Tóm tắt ngắn gọn bài học"
        }
      ]
    }
  ]
}`;

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

  aiRouter.post("/generate-course-quiz", async (req, res) => {
    try {
      const { lessonTitle, lessonSummary } = req.body;
      const prompt = `Tạo 3 câu hỏi trắc nghiệm (quiz) kiểm tra kiến thức cho bài học sau:
Tên bài: "${lessonTitle}"
Tóm tắt nội dung: "${lessonSummary}"

Yêu cầu định dạng JSON chính xác:
{
  "questions": [
    {
      "question": "Nội dung câu hỏi",
      "options": ["Đáp án A", "Đáp án B", "Đáp án C", "Đáp án D"],
      "correctIndex": 0,
      "explanation": "Giải thích ngắn gọn tại sao chọn đáp án này"
    }
  ]
}`;
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

  aiRouter.post("/generate-course-memory", async (req, res) => {
    try {
      const { lessonTitle, lessonSummary } = req.body;
      const prompt = `Tạo bộ công cụ học sâu (active recall và flashcard) cho bài học:
Tên bài: "${lessonTitle}"
Tóm tắt nội dung: "${lessonSummary}"

Yêu cầu định dạng JSON chính xác:
{
  "minuteSummary": "Đoạn tóm tắt cốt lõi trong 60 giây",
  "keyTakeaways": ["Ý chính 1", "Ý chính 2", "Ý chính 3"],
  "terms": [
    { "term": "Khái niệm", "definition": "Định nghĩa" }
  ],
  "recallPrompts": [
    { "prompt": "Câu hỏi mở để người học tự nhớ lại", "answer": "Đáp án hoặc các ý chính cần có" }
  ],
  "flashcards": [
    { "front": "Mặt trước thẻ (Câu hỏi/Khái niệm)", "back": "Mặt sau thẻ (Định nghĩa/Giải thích ngắn)", "hint": "Gợi ý ngắn (tùy chọn)" }
  ]
}`;
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


  aiRouter.post("/summarize-lesson", async (req, res) => {
    try {
      const { lessonTitle, lessonContent, courseTitle } = req.body;
      const prompt = `Hãy đóng vai một trợ lý học tập AI. Tóm tắt bài học sau đây thành các điểm chính (Takeaways) và các khái niệm quan trọng (Key Concepts).
Khóa học: "${courseTitle}"
Tên bài học: "${lessonTitle}"
Nội dung bài học: "${lessonContent}"

Yêu cầu định dạng JSON chính xác:
{
  "takeaways": ["Điểm chính 1", "Điểm chính 2"],
  "keyConcepts": [
    { "term": "Khái niệm 1", "definition": "Định nghĩa ngắn gọn" }
  ]
}`;

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

  aiRouter.post("/generate-recipe", async (req, res) => {
    try {
      const { prompt: userPrompt, goal, mealType } = req.body;
      const ai = getGenAI();
      if (!ai) {
        return res.status(500).json({ error: "Thiếu Gemini API Key trên server" });
      }

      const systemPrompt = `Bạn là Chuyên gia Dinh dưỡng & Đầu bếp Thể hình Aura Fitness hàng đầu.
Sáng tạo công thức món ăn chuẩn thể hình (Fitness Clean Eating / High Protein / Keto / Low Carb) dựa trên yêu cầu:
- Ý tưởng/Thành phần: "${userPrompt || 'Món ăn dinh dưỡng cao cấp tốt cho vóc dáng'}"
- Mục tiêu: "${goal || 'Giảm mỡ'}"
- Bữa ăn: "${mealType || 'Bữa bất kỳ'}"

Yêu cầu trả về đúng định dạng JSON chuẩn xác theo cấu trúc:
{
  "name": "Tên món ăn sáng tạo, hấp dẫn bằng Tiếng Việt",
  "meal": "breakfast" hoặc "lunch" hoặc "dinner" hoặc "snack",
  "goal": "fat-loss" hoặc "muscle-gain" hoặc "maintenance",
  "kcal": số nguyên calo (vd: 420),
  "protein": số nguyên gam đạm (vd: 38),
  "carbs": số nguyên gam carb (vd: 32),
  "fat": số nguyên gam chất béo (vd: 12),
  "minutes": số phút chế biến (vd: 20),
  "diet": "Nhãn chế độ ăn (vd: Giàu Đạm, Ít Carb, Clean Eating)",
  "badge": "Huy hiệu thu hút (vd: Hot Giảm Mỡ, Siêu Đạm, Easy Cook)",
  "description": "Mô tả ngắn về hương vị, công dụng dinh dưỡng (2 câu)",
  "ingredients": ["Nguyên liệu 1 với định lượng", "Nguyên liệu 2..."],
  "instructions": ["Bước 1: ...", "Bước 2: ..."]
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: systemPrompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              meal: { type: Type.STRING },
              goal: { type: Type.STRING },
              kcal: { type: Type.NUMBER },
              protein: { type: Type.NUMBER },
              carbs: { type: Type.NUMBER },
              fat: { type: Type.NUMBER },
              minutes: { type: Type.NUMBER },
              diet: { type: Type.STRING },
              badge: { type: Type.STRING },
              description: { type: Type.STRING },
              ingredients: { type: Type.ARRAY, items: { type: Type.STRING } },
              instructions: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["name", "meal", "goal", "kcal", "protein", "carbs", "fat", "minutes", "diet", "badge", "description", "ingredients", "instructions"]
          }
        }
      });

      const data = JSON.parse(response.text || '{}');
      res.json({ success: true, recipe: data });
    } catch (e: any) {
      console.error('Failed in /api/ai/generate-recipe:', e);
      res.status(500).json({ error: e?.message || "Lỗi tạo món ăn bằng AI" });
    }
  });

  aiRouter.post("/suggest-meal-plan", async (req, res) => {
    try {
      const { goal, targetCalories, targetProtein } = req.body;
      const ai = getGenAI();
      if (!ai) {
        return res.status(500).json({ error: "Thiếu Gemini API Key" });
      }

      const prompt = `Bạn là Chuyên gia thiết kế Thực đơn Thể hình Aura Fitness.
Đề xuất khung thực đơn 7 ngày dành cho mục tiêu: "${goal || 'Giảm mỡ thần tốc'}", mức Calo mục tiêu: ${targetCalories || 1600} kcal/ngày, Đạm mục tiêu: ${targetProtein || 120}g/ngày.

Yêu cầu trả về đúng định dạng JSON:
{
  "title": "Tên khung thực đơn hấp dẫn",
  "summary": "Tóm tắt chiến lược phân bổ calo và dinh dưỡng trong tuần",
  "recommendations": [
    "Gợi ý chiến lược 1",
    "Gợi ý chiến lược 2",
    "Gợi ý chiến lược 3"
  ],
  "sampleDays": [
    {
      "dayName": "Thứ 2",
      "breakfast": "Tên món sáng gợi ý",
      "lunch": "Tên món trưa gợi ý",
      "snack": "Tên món phụ gợi ý",
      "dinner": "Tên món tối gợi ý",
      "totalKcal": 1580,
      "totalProtein": 125
    }
  ]
}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      res.json({ success: true, planSuggestion: JSON.parse(response.text || '{}') });
    } catch (e: any) {
      console.error('Failed in /api/ai/suggest-meal-plan:', e);
      res.status(500).json({ error: "Lỗi tạo gợi ý khung thực đơn" });
    }
  });


  app.post('/api/onboarding/preview', (req, res) => {
    const profile = req.body;
    const currentYear = new Date().getFullYear();
    const age = profile.birthYear ? currentYear - profile.birthYear : 30;
    
    const heightM = (profile.heightCm || 165) / 100;
    const bmi = (profile.weightKg || 60) / (heightM * heightM);
    let bmiLabel = 'Bình thường';
    if (bmi < 18.5) bmiLabel = 'Thiếu cân';
    else if (bmi >= 25) bmiLabel = 'Thừa cân';

    const targetDelta = profile.targetWeightKg ? (profile.targetWeightKg - (profile.weightKg || 60)) : 0;
    
    const pace = profile.pace || 'balanced';
    const weeklyRate = pace === 'fast' ? 0.6 : pace === 'comfortable' ? 0.3 : 0.4;
    const totalWeeks = Math.max(1, Math.abs(targetDelta) / weeklyRate);
    const targetTimeframeMonths = Math.max(1, Math.round(totalWeeks / 4.33));

    const targets = calculateNutritionTargets({
      ...profile,
      age,
      targetWeightDeltaKg: targetDelta,
      targetTimeframeMonths
    });
    
    const plan = {
      age,
      bmi: Math.round(bmi * 10) / 10,
      bmiLabel,
      bmrKcal: targets.bmr,
      tdeeKcal: targets.tdee,
      targetCaloriesKcal: targets.targetCaloriesKcal,
      proteinG: targets.proteinG,
      carbsG: targets.carbsG,
      fatG: targets.fatG,
      waterLiters: targets.waterLiters,
      stepsPerDay: targets.stepsPerDay,
      workoutsPerWeek: profile.activityLevel === 'sedentary' ? 1 : profile.activityLevel === 'light' ? 3 : 5,
      estimatedWeeks: Math.round(totalWeeks),
      targetWeightDeltaKg: targetDelta,
      targetTimeframeMonths
    };
    
    res.json(plan);
  });

  app.use("/api/ai", aiRouter);
  app.use("/api", aiRouter); // Because /api/generateMealReview was originally at /api/

  // Serve firebase-messaging-sw.js with env vars
  app.get('/firebase-messaging-sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    
    // Prioritize .env parsing
    const getEnv = (key) => {
       try {
           const envFile = fs.readFileSync('.env', 'utf-8');
           const match = envFile.match(new RegExp(`^${key}=(.*)$`, 'm'));
           if (match && match[1].trim() !== 'your_api_key' && !match[1].includes('your_')) {
               return match[1].trim();
           }
       } catch(e) {}
       return process.env[key] || '';
    };

    res.send(`
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "${getEnv('VITE_FIREBASE_API_KEY')}",
  authDomain: "${getEnv('VITE_FIREBASE_AUTH_DOMAIN')}",
  projectId: "${getEnv('VITE_FIREBASE_PROJECT_ID')}",
  storageBucket: "${getEnv('VITE_FIREBASE_STORAGE_BUCKET')}",
  messagingSenderId: "${getEnv('VITE_FIREBASE_MESSAGING_SENDER_ID')}",
  appId: "${getEnv('VITE_FIREBASE_APP_ID')}"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification.title || 'Thông báo';
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/icon.png',
    data: payload.data
  };
  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.notification.data && event.notification.data.actionUrl) {
    event.waitUntil(
      clients.openWindow(event.notification.data.actionUrl)
    );
  }
});
    `);
  });

  // Notification Cron Job
  setInterval(async () => {
    if (!adminInitialized) return;
    try {
      const db = getFirestore();
      const now = new Date();
      // Only run roughly on the minute mark (we run every minute but to avoid multiple sends we can mark them)
      const currentHour = String(now.getHours()).padStart(2, '0');
      const currentMinute = String(now.getMinutes()).padStart(2, '0');
      const currentTimeStr = `${currentHour}:${currentMinute}`;
      
      const usersSnap = await db.collection('users')
         .where('mealReminderTime', '==', currentTimeStr)
         .get();
         
      const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      for (const doc of usersSnap.docs) {
         const user = doc.data();
         if (!user.fcmTokens || user.fcmTokens.length === 0) continue;
         
         // Check if already sent today
         const notifId = `meal_reminder_${today}`;
         const notifRef = db.collection('users').doc(doc.id).collection('notifications').doc(notifId);
         const notifSnap = await notifRef.get();
         if (notifSnap.exists) continue; // Already sent today
         
         // Check if meal uploaded today
         // Simplified check: if they have a meal log today
         const mealsSnap = await db.collection('users').doc(doc.id).collection('mealLogs')
            .where('dateString', '==', today)
            .limit(1)
            .get();
            
         if (!mealsSnap.empty) continue; // Already uploaded
         
         // Create notification record
         await notifRef.set({
           id: notifId,
           userId: doc.id,
           title: 'Nhắc nhở cập nhật bữa ăn 🥗',
           message: 'Đã đến giờ cập nhật nhật ký ăn uống của bạn. Đừng quên nhé!',
           type: 'REMINDER',
           read: false,
           actionUrl: '/nutrition',
           dateString: today,
           createdAt: FieldValue.serverTimestamp()
         });
         
         // Send FCM Push
         const message = {
           notification: {
             title: 'Nhắc nhở cập nhật bữa ăn 🥗',
             body: 'Đã đến giờ cập nhật nhật ký ăn uống của bạn. Đừng quên nhé!'
           },
           data: {
             actionUrl: '/nutrition'
           },
           tokens: user.fcmTokens
         };
         
         try {
           const response = await getMessaging().sendEachForMulticast(message);
           console.log(`Sent FCM to ${doc.id}, successes: ${response.successCount}, failures: ${response.failureCount}`);
         } catch (fcmErr) {
           console.error(`FCM send error for ${doc.id}:`, fcmErr);
         }
      }
    } catch (e) {
      console.error("Cron error:", e);
    }
  }, 60 * 1000); // Check every minute

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
