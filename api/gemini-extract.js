export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not set in Vercel environment variables.' });
    }

    const { imageDataUrl } = req.body;
    if (!imageDataUrl) {
      return res.status(400).json({ error: 'Image data URL is required.' });
    }

    const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');

    // Direct REST API call to Gemini to bypass SDK strict token checks
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const payload = {
      contents: [
        {
          parts: [
            {
              text: "You are an expert exam paper digitizer. Analyze this PDF page image. Extract all questions along with their options (A, B, C, D) and topic. Return a strict JSON object with this exact structure: {\"items\": [{\"qNo\": \"1\", \"qText\": \"Question text here\", \"optA\": \"Option A text\", \"optB\": \"Option B text\", \"optC\": \"Option C text\", \"optD\": \"Option D text\", \"topic\": \"Physics Topic\"}]}"
            },
            {
              inline_data: {
                mime_type: "image/jpeg",
                data: base64Data
              }
            }
          ]
        }
      ],
      generationConfig: {
        response_mime_type: "application/json"
      }
    };

    const apiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await apiRes.json();
    
    if (!apiRes.ok) {
      throw new Error(data.error?.message || 'Gemini API error ' + apiRes.status);
    }

    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textContent) {
      throw new Error('No text generated from Gemini model.');
    }

    const jsonParsed = JSON.parse(textContent);
    return res.status(200).json(jsonParsed);

  } catch (err) {
    console.error('Gemini extraction error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error during AI extraction.' });
  }
}
