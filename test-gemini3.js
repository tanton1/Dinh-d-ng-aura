import { GoogleGenAI } from "@google/genai";
import dotenv from 'dotenv';
dotenv.config();

async function test() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const models = ['gemini-flash-latest', 'gemini-flash', 'gemini-pro', 'gemini-3.1-flash', 'gemini-3.1-pro-preview', 'gemini-3.5-flash'];
  
  for (const m of models) {
    try {
      const response = await ai.models.generateContent({
        model: m,
        contents: 'Hello',
      });
      console.log("SUCCESS " + m + ":", response.text.substring(0, 20));
    } catch (e) {
      console.error("ERROR " + m + ":", e.message);
    }
  }
}
test();
