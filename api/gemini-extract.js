import { GoogleGenAI } from '@google/genai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not set in Vercel environment variables.' });
    }

    const { mode, imageDataUrl, folders } = req.body;
    if (!imageDataUrl) {
      return res.status(400).json({ error: 'Image data URL is required.' });
    }

    const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const ai = new GoogleGenAI({ apiKey: apiKey });
    
    const prompt = `You are an expert exam paper digitizer. Analyze this PDF page image. Extract all questions along with their options (A, B, C, D) and topic. Return a strict JSON object with this exact structure:
    {
      "items": [
        {
          "qNo": "1",
          "qText": "Question text here",
          "optA": "Option A text",
          "optB": "Option B text",
          "optC": "Option C text",
          "optD": "Option D text",
          "topic": "Physics Topic"
        }
      ]
    }`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        { text: prompt },
        {
          inlineData: {
            data: buffer.toString('base64'),
            mimeType: 'image/jpeg'
          }
        }
      ],
      config: {
        responseMimeType: 'application/json'
      }
    });

    const textResult = response.text();
    const jsonParsed = JSON.parse(textResult);

    return res.status(200).json(jsonParsed);
  } catch (err) {
    console.error('Gemini extraction error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error during AI extraction.' });
  }
}
