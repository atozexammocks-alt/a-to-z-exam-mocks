const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';

const itemSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      qNo: { type: 'integer' },
      qText: { type: 'string' },
      optA: { type: 'string' },
      optB: { type: 'string' },
      optC: { type: 'string' },
      optD: { type: 'string' },
      key: { type: 'string' },
      topic: { type: 'string' },
      targetPath: { type: 'string' }
    },
    required: ['qNo', 'qText', 'optA', 'optB', 'optC', 'optD', 'key', 'topic', 'targetPath']
  }
};

const boxSchema = {
  type: 'object',
  properties: {
    question: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        w: { type: 'number' },
        h: { type: 'number' }
      },
      required: ['x', 'y', 'w', 'h']
    },
    solution: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        w: { type: 'number' },
        h: { type: 'number' }
      },
      required: ['x', 'y', 'w', 'h']
    },
    confidence: { type: 'number' },
    note: { type: 'string' }
  },
  required: ['question', 'solution', 'confidence', 'note']
};

function send(res, status, body) {
  res
    .status(status)
    .setHeader('Content-Type', 'application/json; charset=utf-8')
    .send(JSON.stringify(body));
}

function parseImage(s) {
  const m = String(s || '').match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i);
  if (!m) return null;
  return {
    mime: m[1].toLowerCase().replace('jpg', 'jpeg'),
    data: m[2]
  };
}

function extractGoogleError(raw, httpStatus) {
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {}

  const err = parsed?.error;
  const details = Array.isArray(err?.details)
    ? err.details.map((d) => ({
        reason: d?.reason || null,
        domain: d?.domain || null,
        metadata: d?.metadata || null,
        message: d?.localizedMessage?.message || d?.message || null
      }))
    : [];

  const reasons = details.map((d) => d.reason).filter(Boolean);

  return {
    httpStatus,
    status: err?.status || null,
    code: err?.code || httpStatus,
    message: err?.message || 'Gemini API request failed.',
    reasons,
    details,
    raw: raw ? raw.slice(0, 4000) : ''
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return send(res, 405, { error: 'POST only' });
  }

  if (!API_KEY) {
    console.error('[Gemini] API key missing from Vercel environment.');
    return send(res, 500, {
      error: 'Gemini API key is not configured on the server. Add GEMINI_API_KEY to Vercel Production and redeploy.'
    });
  }

  try {
    const {
      mode = 'extract',
      pageText = '',
      imageDataUrl = '',
      folders = ''
    } = req.body || {};

    if (!pageText && !imageDataUrl) {
      return send(res, 400, { error: 'pageText or imageDataUrl is required.' });
    }

    const image = parseImage(imageDataUrl);
    if (imageDataUrl && !image) {
      return send(res, 400, { error: 'Invalid imageDataUrl.' });
    }
    if (image && image.data.length > 5500000) {
      return send(res, 413, {
        error: 'Image is too large for the AI endpoint. Reduce the image size first.'
      });
    }

    let schema;
    let prompt;

    if (mode === 'detect_boxes') {
      if (!image) {
        return send(res, 400, { error: 'detect_boxes requires imageDataUrl.' });
      }
      schema = boxSchema;
      prompt = 'You are an exam PDF layout detector. Inspect this FULL single PDF page image. Identify the main question region and the answer/solution region if a distinct answer/solution is visibly present on this page. Return normalized bounding boxes using x,y,w,h from 0 to 1000, where (0,0) is the top-left. The question box should contain the complete MCQ statement and its options, but not unrelated neighboring questions when possible. The solution box should contain the visible answer/solution/explanation for that question. If no distinct solution is visible, return a small reasonable box around the visible answer/key area; never invent content. Keep boxes inside the page. Confidence is 0-1.';
    } else {
      const imageOnly = !!image && !pageText;
      schema = itemSchema;
      prompt = imageOnly
        ? 'Extract the MCQ(s) visible in this image.'
        : 'Extract EVERY MCQ visible in this single PDF page. Preserve mathematical symbols, subscripts, superscripts, Hindi/English text and numbering. Never invent missing text.';
      prompt += ' Return only the requested JSON array. If an answer key is not visible, return an empty key. Choose the closest library path from [' + folders + '].';
    }

    const parts = [{ text: prompt }];
    if (pageText) parts.push({ text: 'Native PDF text:\n' + pageText });
    if (image) {
      parts.push({
        inline_data: {
          mime_type: image.mime,
          data: image.data
        }
      });
    }

    const endpoint =
      'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(MODEL) +
      ':generateContent';

    console.log(`[Gemini] Request: mode=${mode}, model=${MODEL}, image=${!!image}, text=${!!pageText}`);

    const r = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': API_KEY
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 0.1,
          maxOutputTokens: 4096
        }
      })
    });

    const raw = await r.text();

    if (!r.ok) {
      const googleError = extractGoogleError(raw, r.status);

      console.error('[Gemini] API ERROR', {
        httpStatus: googleError.httpStatus,
        status: googleError.status,
        code: googleError.code,
        reasons: googleError.reasons,
        message: googleError.message,
        details: googleError.details
      });

      let userMessage = `Gemini API ${googleError.httpStatus}`;
      if (googleError.status) userMessage += ` ${googleError.status}`;
      if (googleError.reasons.length) userMessage += ` — ${googleError.reasons.join(', ')}`;
      userMessage += `: ${googleError.message}`;

      return send(res, r.status, {
        error: userMessage,
        google: {
          httpStatus: googleError.httpStatus,
          status: googleError.status,
          code: googleError.code,
          reasons: googleError.reasons,
          message: googleError.message,
          details: googleError.details
        },
        model: MODEL
      });
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      console.error('[Gemini] Invalid JSON gateway response:', raw.slice(0, 2000));
      return send(res, 502, { error: 'Invalid response from Gemini gateway.' });
    }

    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text || '').join('') || '';

    if (!text) {
      console.error('[Gemini] No candidate content', {
        promptFeedback: data.promptFeedback || null,
        finishReason: candidate?.finishReason || null
      });
      return send(res, 502, {
        error: 'Gemini returned no result.',
        detail: data.promptFeedback || candidate?.finishReason || 'No candidate content.'
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      console.error('[Gemini] Invalid model JSON:', text.slice(0, 2000));
      return send(res, 502, {
        error: 'Gemini returned invalid JSON.',
        detail: text.slice(0, 2000)
      });
    }

    console.log(`[Gemini] Success: mode=${mode}, model=${MODEL}`);

    return mode === 'detect_boxes'
      ? send(res, 200, { boxes: parsed })
      : send(res, 200, { items: Array.isArray(parsed) ? parsed : [] });
  } catch (e) {
    console.error('[Gemini] Server exception:', e);
    return send(res, 500, {
      error: e?.message || 'Unknown extraction error'
    });
  }
};
