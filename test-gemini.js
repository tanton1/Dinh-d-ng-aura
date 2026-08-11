import { GoogleGenAI } from "@google/genai";
import dotenv from 'dotenv';
dotenv.config();

async function test() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'Hello',
    });
    console.log("SUCCESS 2.5:", response.text);
  } catch (e) {
    console.error("ERROR 2.5:", e.message);
  }

  try {
    const response2 = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: 'Hello',
    });
    console.log("SUCCESS 3.6:", response2.text);
  } catch (e) {
    console.error("ERROR 3.6:", e.message);
  }
}
test();
