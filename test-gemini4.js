import { GoogleGenAI, Type } from "@google/genai";
import dotenv from 'dotenv';
dotenv.config();

async function test() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: 'Give me a simple JSON with a greeting.',
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: { greeting: { type: Type.STRING } }
        }
      }
    });
    console.log("SUCCESS:", response.text);
  } catch (e) {
    console.error("ERROR 3.6 with Schema:", e.message);
  }
}
test();
