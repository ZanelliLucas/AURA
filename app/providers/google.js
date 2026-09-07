const { GoogleGenAI } = require('@google/genai');

async function complete({ apiKey, model, systemPrompt, messages }) {
  const ai = new GoogleGenAI({ apiKey });

  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const response = await ai.models.generateContent({
    model,
    contents,
    config: { systemInstruction: systemPrompt }
  });

  return { text: response.text };
}

module.exports = { complete };
