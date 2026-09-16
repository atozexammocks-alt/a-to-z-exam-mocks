const MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash'
];
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
    question: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }, required: ['x', 'y', 'w', 'h'] },
    solution: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }, required: ['x', 'y', 'w', 'h'] },
    confidence: { type: 'number' },
    note: { type: 'string' }
  },
  required: ['question', 'solution', 'confidence', 'note']
};

const scanSchema = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          qNo: { type: 'integer' }, qText: { type: 'string' }, optA: { type: 'string' }, optB: { type: 'string' }, optC: { type: 'string' }, optD: { type: 'string' }, key: { type: 'string' }, topic: { type: 'string' }, mainFolder: { type: 'string' }, subFolder: { type: 'string' }, createMainFolder: { type: 'boolean' }, createSubFolder: { type: 'boolean' },
          questionBox: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }, required: ['x', 'y', 'w', 'h'] },
          solutionBox: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }, required: ['x', 'y', 'w', 'h'] }
        },
        required: ['qNo', 'qText', 'optA', 'optB', 'optC', 'optD', 'key', 'topic', 'mainFolder', 'subFolder', 'createMainFolder', 'createSubFolder', 'questionBox', 'solutionBox']
      }
    }
  },
  required: ['questions']
};

function send(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(body));
}

function parseImage(s) {
  const m = String(s || '').match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i);
  if (!m) return null;
  return { mime: m[1].toLowerCase().replace('jpg', 'jpeg'), data: m[2] };
}

function extractGoogleError(raw, httpStatus) {
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (_) {}
  const err = parsed?.error;
  const details = Array.isArray(err?.details) ? err.details.map((d) => ({ reason: d?.reason || null, domain: d?.domain || null, metadata: d?.metadata || null, message: d?.localizedMessage?.message || d?.message || null })) : [];
  return { httpStatus, status: err?.status || null, code: err?.code || httpStatus, message: err?.message || 'Gemini API request failed.', reasons: details.map((d) => d.reason).filter(Boolean), details, raw: raw ? raw.slice(0, 4000) : '' };
}

function shouldFallback(g) {
  const status = Number(g.httpStatus);
  const statusText = String(g.status || '').toUpperCase();
  const reasonText = g.reasons.join(' ').toUpperCase();
  const messageText = String(g.message || '').toUpperCase();
  return [404, 408, 409, 429, 500, 502, 503, 504].includes(status) || ['NOT_FOUND', 'UNAVAILABLE', 'RESOURCE_EXHAUSTED', 'OVERLOADED', 'DEADLINE_EXCEEDED', 'RATE_LIMIT'].some(x => statusText.includes(x) || reasonText.includes(x) || messageText.includes(x));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  if (!API_KEY) return send(res, 500, { error: 'Gemini API key is not configured on the server. Add GEMINI_API_KEY to Vercel Production and redeploy.' });

  try {
    const { mode = 'extract', pageText = '', imageDataUrl = '', folders = '' } = req.body || {};
    if (!pageText && !imageDataUrl) return send(res, 400, { error: 'pageText or imageDataUrl is required.' });
    const image = parseImage(imageDataUrl);
    if (imageDataUrl && !image) return send(res, 400, { error: 'Invalid imageDataUrl.' });
    if (image && image.data.length > 5500000) return send(res, 413, { error: 'Image is too large for the AI endpoint. Reduce the image size first.' });

    let schema, prompt;
    if (mode === 'detect_boxes') {
      if (!image) return send(res, 400, { error: 'detect_boxes requires imageDataUrl.' });
      schema = boxSchema;
      prompt = 'You are an exam PDF layout detector. Inspect this FULL single PDF page image. Identify the main question region and the answer/solution region if a distinct answer/solution is visibly present. Return normalized x,y,w,h boxes from 0 to 1000. The question box should contain the complete MCQ statement and options. Keep boxes inside the page. Confidence 0-1.';
    } else if (mode === 'scan_questions') {
      if (!image) return send(res, 400, { error: 'scan_questions requires imageDataUrl.' });
      schema = scanSchema;
      prompt = 'You are an exam-page scanner. Inspect the FULL single PDF page image and identify every distinct MCQ/question visible in reading order. Extract question text/options and normalized question/solution boxes x,y,w,h from 0 to 1000. Classify each question into the closest existing Book Section/Sub-section from this list: [' + folders + ']. If no reasonable match exists, create a clean new mainFolder/subFolder based only on the topic. Never invent unrelated folder names.';
    } else {
      schema = itemSchema;
      prompt = image && !pageText ? 'Extract the MCQ(s) visible in this image.' : 'Extract EVERY MCQ visible in this single PDF page. Preserve mathematical symbols, subscripts, superscripts, Hindi/English text and numbering. Never invent missing text.';
      prompt += ' Return only the requested JSON array. If an answer key is not visible, return an empty key. Choose the closest library path from [' + folders + '].';
    }

    const parts = [{ text: prompt }];
    if (pageText) parts.push({ text: 'Native PDF text:\n' + pageText });
    if (image) parts.push({ inline_data: { mime_type: image.mime, data: image.data } });

    let lastFailure = null;
    for (const model of MODELS) {
      const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
      console.log(`[Gemini] Request: mode=${mode}, model=${model}, image=${!!image}, text=${!!pageText}`);
      try {
        const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY }, body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.1, maxOutputTokens: 4096 } }) });
        const raw = await r.text();
        if (!r.ok) {
          const googleError = extractGoogleError(raw, r.status);
          lastFailure = { googleError, model };
          console.error('[Gemini] API ERROR', { model, httpStatus: googleError.httpStatus, status: googleError.status, code: googleError.code, reasons: googleError.reasons, message: googleError.message });
          if (shouldFallback(googleError)) { console.warn(`[Gemini] Falling back from ${model} to next model.`); continue; }
          return send(res, r.status, { error: `Gemini API ${googleError.httpStatus}${googleError.status ? ` ${googleError.status}` : ''}: ${googleError.message}`, google: googleError, model });
        }
        let data;
        try { data = JSON.parse(raw); } catch (_) { lastFailure = { model, message: 'Invalid JSON gateway response.' }; continue; }
        const candidate = data.candidates?.[0];
        const text = candidate?.content?.parts?.map((p) => p.text || '').join('') || '';
        if (!text) { lastFailure = { model, message: 'Gemini returned no result.' }; continue; }
        let parsed;
        try { parsed = JSON.parse(text); } catch (_) { lastFailure = { model, message: 'Gemini returned invalid JSON.' }; continue; }
        console.log(`[Gemini] Success: mode=${mode}, model=${model}`);
        if (mode === 'detect_boxes') return send(res, 200, { boxes: parsed, model });
        if (mode === 'scan_questions') return send(res, 200, { questions: Array.isArray(parsed?.questions) ? parsed.questions : [], model });
        return send(res, 200, { items: Array.isArray(parsed) ? parsed : [], model });
      } catch (modelError) {
        lastFailure = { model, message: modelError?.message || 'Network/model request error.' };
        console.error(`[Gemini] Model ${model} exception:`, modelError);
      }
    }

    const finalGoogle = lastFailure?.googleError;
    return send(res, finalGoogle?.httpStatus || 503, {
      error: finalGoogle ? `Gemini fallback exhausted after trying ${MODELS.join(', ')}. Last error: ${finalGoogle.message}` : `Gemini fallback exhausted after trying ${MODELS.join(', ')}. ${lastFailure?.message || 'No model returned a usable result.'}`,
      google: finalGoogle || null,
      triedModels: MODELS,
      model: lastFailure?.model || null
    });
  } catch (e) {
    console.error('[Gemini] Server exception:', e);
    return send(res, 500, { error: e?.message || 'Unknown extraction error' });
  }
};
