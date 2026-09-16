const MODELS = [
  process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro'
].filter((model, index, list) => model && list.indexOf(model) === index);
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
        x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' }
      },
      required: ['x', 'y', 'w', 'h']
    },
    solution: {
      type: 'object',
      properties: {
        x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' }
      },
      required: ['x', 'y', 'w', 'h']
    },
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
          qNo: { type: 'integer' },
          qText: { type: 'string' },
          optA: { type: 'string' },
          optB: { type: 'string' },
          optC: { type: 'string' },
          optD: { type: 'string' },
          key: { type: 'string' },
          topic: { type: 'string' },
          mainFolder: { type: 'string' },
          subFolder: { type: 'string' },
          createMainFolder: { type: 'boolean' },
          createSubFolder: { type: 'boolean' },
          questionBox: {
            type: 'object',
            properties: {
              x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' }
            },
            required: ['x', 'y', 'w', 'h']
          },
          solutionBox: {
            type: 'object',
            properties: {
              x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' }
            },
            required: ['x', 'y', 'w', 'h']
          }
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
  const details = Array.isArray(err?.details) ? err.details.map((d) => ({
    reason: d?.reason || null,
    domain: d?.domain || null,
    metadata: d?.metadata || null,
    message: d?.localizedMessage?.message || d?.message || null
  })) : [];
  return {
    httpStatus,
    status: err?.status || null,
    code: err?.code || httpStatus,
    message: err?.message || 'Gemini API request failed.',
    reasons: details.map((d) => d.reason).filter(Boolean),
    details,
    raw: raw ? raw.slice(0, 4000) : ''
  };
}

function shouldFallback(g) {
  const transientStatuses = new Set([429, 500, 502, 503, 504]);
  const statusText = String(g.status || '').toUpperCase();
  const reasonText = g.reasons.join(' ').toUpperCase();
  const messageText = String(g.message || '').toUpperCase();
  return transientStatuses.has(Number(g.httpStatus)) ||
    ['UNAVAILABLE', 'RESOURCE_EXHAUSTED', 'OVERLOADED', 'DEADLINE_EXCEEDED'].some(x =>
      statusText.includes(x) || reasonText.includes(x) || messageText.includes(x)
    );
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });

  if (!API_KEY) {
    console.error('[Gemini] API key missing from Vercel environment.');
    return send(res, 500, { error: 'Gemini API key is not configured on the server. Add GEMINI_API_KEY to Vercel Production and redeploy.' });
  }

  try {
    const { mode = 'extract', pageText = '', imageDataUrl = '', folders = '' } = req.body || {};
    if (!pageText && !imageDataUrl) return send(res, 400, { error: 'pageText or imageDataUrl is required.' });

    const image = parseImage(imageDataUrl);
    if (imageDataUrl && !image) return send(res, 400, { error: 'Invalid imageDataUrl.' });
    if (image && image.data.length > 5500000) return send(res, 413, { error: 'Image is too large for the AI endpoint. Reduce the image size first.' });

    let schema;
    let prompt;
    if (mode === 'detect_boxes') {
      if (!image) return send(res, 400, { error: 'detect_boxes requires imageDataUrl.' });
      schema = boxSchema;
      prompt = 'You are an exam PDF layout detector. Inspect this FULL single PDF page image. Identify the main question region and the answer/solution region if a distinct answer/solution is visibly present on this page. Return normalized bounding boxes using x,y,w,h from 0 to 1000, where (0,0) is the top-left. The question box should contain the complete MCQ statement and its options, but not unrelated neighboring questions when possible. The solution box should contain the visible answer/solution/explanation for that question. If no distinct solution is visible, return a small reasonable box around the visible answer/key area; never invent content. Keep boxes inside the page. Confidence is 0-1.';
    } else if (mode === 'scan_questions') {
      if (!image) return send(res, 400, { error: 'scan_questions requires imageDataUrl.' });
      schema = scanSchema;
      prompt = 'You are an exam-page scanner. Inspect the FULL single PDF page image and identify every distinct MCQ/question visible on the page. Return one object per question in reading order. For each question, provide the complete question text and A-D options when visible, a solution box if a visible answer/solution exists (otherwise use a small reasonable answer/key area), and normalized question/solution bounding boxes x,y,w,h from 0 to 1000. Classify each question into the closest existing Book Section and Sub-section from this list: [' + folders + ']. If none is a reasonable match, set createMainFolder=true and/or createSubFolder=true and provide a clean new mainFolder/subFolder name based only on the question topic. Never invent folder names unrelated to the question. Keep boxes inside the page.';
    } else {
      schema = itemSchema;
      const imageOnly = !!image && !pageText;
      prompt = imageOnly ? 'Extract the MCQ(s) visible in this image.' : 'Extract EVERY MCQ visible in this single PDF page. Preserve mathematical symbols, subscripts, superscripts, Hindi/English text and numbering. Never invent missing text.';
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
        const r = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
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
          lastFailure = { googleError, model };
          console.error('[Gemini] API ERROR', { model, httpStatus: googleError.httpStatus, status: googleError.status, code: googleError.code, reasons: googleError.reasons, message: googleError.message, details: googleError.details });
          if (shouldFallback(googleError)) {
            console.warn(`[Gemini] Falling back from ${model} to next model.`);
            continue;
          }
          return send(res, r.status, {
            error: `Gemini API ${googleError.httpStatus}${googleError.status ? ` ${googleError.status}` : ''}${googleError.reasons.length ? ` — ${googleError.reasons.join(', ')}` : ''}: ${googleError.message}`,
            google: googleError,
            model
          });
        }

        let data;
        try { data = JSON.parse(raw); } catch (_) {
          lastFailure = { model, message: 'Invalid JSON gateway response.' };
          continue;
        }

        const candidate = data.candidates?.[0];
        const text = candidate?.content?.parts?.map((p) => p.text || '').join('') || '';
        if (!text) {
          lastFailure = { model, message: 'Gemini returned no result.', detail: data.promptFeedback || candidate?.finishReason || 'No candidate content.' };
          continue;
        }

        let parsed;
        try { parsed = JSON.parse(text); } catch (_) {
          lastFailure = { model, message: 'Gemini returned invalid JSON.', detail: text.slice(0, 2000) };
          continue;
        }

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
    const finalMessage = finalGoogle
      ? `Gemini fallback exhausted after trying ${MODELS.join(', ')}. Last error: ${finalGoogle.message}`
      : `Gemini fallback exhausted after trying ${MODELS.join(', ')}. ${lastFailure?.message || 'No model returned a usable result.'}`;
    return send(res, finalGoogle?.httpStatus || 503, {
      error: finalMessage,
      google: finalGoogle || null,
      triedModels: MODELS,
      model: lastFailure?.model || null
    });
  } catch (e) {
    console.error('[Gemini] Server exception:', e);
    return send(res, 500, { error: e?.message || 'Unknown extraction error' });
  }
};
