import { GoogleGenAI, Type } from "@google/genai";
import dotenv from 'dotenv';
dotenv.config();

async function test() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    const base64Pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const response = await ai.models.generateContent({
      model: 'gemini-flash-latest',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/png', data: base64Pixel } },
          { text: 'Describe the image' }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: { description: { type: Type.STRING } }
        }
      }
    });
    console.log("SUCCESS:", response.text);
  } catch (e) {
    console.error("ERROR:", e.message);
  }
}
test();
