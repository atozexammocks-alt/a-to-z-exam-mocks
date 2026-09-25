// Free/low-cost multimodal fallback chain. The first available Gemini model is tried first.
// 2.5 models are retained only as legacy fallbacks because Google currently limits new access to them.
const GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash'
];
const API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_MODEL = 'openrouter/free';
const MAX_REQUEST_BYTES = 4400000;
const MAX_IMAGE_BASE64_CHARS = 3000000;
const box={type:'object',properties:{x:{type:'number'},y:{type:'number'},w:{type:'number'},h:{type:'number'}},required:['x','y','w','h']};
const opt={type:'object',properties:{text:{type:'string'},box},required:['text','box']};
const itemSchema={type:'array',items:{type:'object',properties:{qNo:{type:'integer'},qText:{type:'string'},optA:opt,optB:opt,optC:opt,optD:opt,key:{type:'string'},topic:{type:'string'},targetPath:{type:'string'},questionBox:box,solutionBox:box},required:['qNo','qText','optA','optB','optC','optD','key','topic','targetPath','questionBox','solutionBox']}};
const scanSchema={type:'object',properties:{questions:{type:'array',items:{type:'object',properties:{qNo:{type:'integer'},qText:{type:'string'},optA:opt,optB:opt,optC:opt,optD:opt,key:{type:'string'},topic:{type:'string'},mainFolder:{type:'string'},subFolder:{type:'string'},createMainFolder:{type:'boolean'},createSubFolder:{type:'boolean'},questionBox:box,solutionBox:box},required:['qNo','qText','optA','optB','optC','optD','key','topic','mainFolder','subFolder','createMainFolder','createSubFolder','questionBox','solutionBox']}}},required:['questions']};
const boxSchema={type:'object',properties:{question:box,solution:box,confidence:{type:'number'},note:{type:'string'}},required:['question','solution','confidence','note']};
function send(res,status,body){
  try {
    const payload=JSON.stringify(body);
    res.status(status).setHeader('Content-Type','application/json; charset=utf-8').setHeader('Cache-Control','no-store').send(payload);
  } catch(err) {
    console.error('[Gemini] response serialization/send failed',err);
    try { res.status(500).send(JSON.stringify({error:'Backend failed while creating the response.',type:err?.name||'Error'})); } catch(_) {}
  }
}
function parseImage(s){const m=String(s||'').match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i);if(!m)return null;return{mime:m[1].toLowerCase().replace('jpg','jpeg'),data:m[2]};}
function cleanMath(s){
  // Keep mathematical structure and actively reject the common "Python-code"
  // representation that can appear when a model OCRs equations.
  if(typeof s!=='string') return s;
  let t=s.trim();
  t=t.replace(/\\\\\?\\?frac/g,'\\\\frac');
  t=t.replace(/\\\\\?\\?sqrt\\s*\\(([^()]+)\\)/g,'\\\\sqrt{$1}');
  t=t.replace(/\\b(?:math|numpy|np)\\.sqrt\\s*\\(([^()]+)\\)/g,'\\\\sqrt{$1}');
  t=t.replace(/([A-Za-z0-9)\\]}]+)\\s*\\*\\*\\s*(-?\\d+)/g,'$1^{$2}');
  t=t.replace(/\\(([^()\\s]+)\\)\\s*\\/\\s*\\(([^()\\s]+)\\)/g,'\\\\frac{$1}{$2}');
  t=t.replace(/\\b([A-Za-z0-9]+)\\s*\\/\\s*([A-Za-z0-9]+)\\b/g,'\\\\frac{$1}{$2}');
  return t;
}
function cleanQuestion(q){if(!q||typeof q!=='object')return q;for(const k of ['qText','optA','optB','optC','optD','key','topic','targetPath','mainFolder','subFolder']){if(typeof q[k]==='string')q[k]=cleanMath(q[k]);else if(q[k]&&typeof q[k]==='object'&&typeof q[k].text==='string')q[k].text=cleanMath(q[k].text);}return q;}
function cleanQuestions(a){return Array.isArray(a)?a.map(cleanQuestion):[];}
function extractGoogleError(raw,httpStatus){let p=null;try{p=JSON.parse(raw)}catch(_){}const e=p?.error;const details=Array.isArray(e?.details)?e.details.map(d=>({reason:d?.reason||null,domain:d?.domain||null,message:d?.localizedMessage?.message||d?.message||null})):[];return{httpStatus,status:e?.status||null,code:e?.code||httpStatus,message:e?.message||'Gemini API request failed.',reasons:details.map(d=>d.reason).filter(Boolean),details,raw:String(raw||'').slice(0,4000)};}
function shouldFallback(g){const s=Number(g.httpStatus),t=((g.status||'')+' '+(g.reasons||[]).join(' ')+' '+(g.message||'')).toUpperCase();return[404,408,409,429,500,502,503,504].includes(s)||['NOT_FOUND','UNAVAILABLE','RESOURCE_EXHAUSTED','OVERLOADED','DEADLINE_EXCEEDED','RATE_LIMIT'].some(x=>t.includes(x));}
async function handler(req,res){if(req.method!=='POST')return send(res,405,{error:'POST only'});if(!API_KEY && !OPENROUTER_API_KEY)return send(res,500,{error:'No AI API key is configured. Add GEMINI_API_KEY to Vercel Production; OPENROUTER_API_KEY is an optional final free-router fallback.'});try{let body=req.body||{}; if(typeof body==='string'){try{body=JSON.parse(body)}catch(_){return send(res,400,{error:'Invalid JSON request body.'})}} const contentLength=Number(req.headers?.['content-length']||0);
if(contentLength>MAX_REQUEST_BYTES)return send(res,413,{error:'Request body is too large. Send native PDF text first and compress any fallback image before calling this endpoint.',contentLength,maxRequestBytes:MAX_REQUEST_BYTES});
const{mode='extract',pageText='',imageDataUrl='',folders='',pdfBase64='',pageNumber=null}=body;

if(mode==='pdf_extract'){
  if(!API_KEY)return send(res,503,{error:'GEMINI_API_KEY is required for native PDF extraction.'});
  if(!pdfBase64)return send(res,400,{error:'pdfBase64 is required for native PDF extraction.'});
  if(String(pdfBase64).length>4200000)return send(res,413,{error:'This single PDF page is too large for the server request. The uploader will use the full-page image fallback instead.',pdfChars:String(pdfBase64).length});
  const retryAttempt=Math.max(0,Number(body?.retryAttempt||0));
  const model=GEMINI_MODELS[retryAttempt];
  if(!model)return send(res,503,{error:'All Gemini native-PDF fallbacks were exhausted.',retryAttempt,modelsTried:GEMINI_MODELS});
  const prompt=`You are extracting questions from ONE COMPLETE PDF PAGE of an exam paper.

This request contains exactly ONE PDF page. Process ONLY this page.
Extract EVERY MCQ/question visible on this page, in reading order. Do not summarize, merge, omit, or invent questions.

For EVERY question:
- qNo: printed question number if visible, otherwise sequential number.
- qText: complete question statement.
- optA, optB, optC, optD: extract every visible option separately. Never leave a visible option blank merely because it wraps to another line, contains equations, Hindi/English text, or a figure.
- key: answer only if explicitly visible/determinable; otherwise "".
- topic: concise subject/topic.
- targetPath: choose the closest existing library path from [${folders}].
- questionBox: normalized x,y,w,h from 0 to 1000 covering the COMPLETE question including all options and figures.
- solutionBox: normalized box only if a distinct visible solution exists; otherwise {x:0,y:0,w:0,h:0}.

Mathematics and science MUST be preserved as LaTeX. Preserve fractions, roots, powers, subscripts, vectors, Greek letters, integrals, matrices, determinants, chemical notation and units. Do not use Python/code notation such as sqrt(...), **, math.sqrt(...), np.sqrt(...).

IMPORTANT:
- The PDF itself is authoritative; do not rely on guesses from surrounding questions.
- Read the whole page before deciding how many questions it contains.
- A question may continue across multiple lines/columns. Keep its full text and all four options together.
- If there are 10 questions on the page, return 10 objects. If there are 11, return 11.
- Do not include questions from any other page.

OUTPUT ONLY a valid JSON ARRAY. No markdown, no explanation, no code fence.
Each object must contain exactly these useful fields:
qNo,qText,optA,optB,optC,optD,key,topic,targetPath,questionBox,solutionBox.`;

  const endpoint='https://generativelanguage.googleapis.com/v1beta/interactions';
  const started=Date.now();
  try{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),30000);
    let r;
    try{
      r=await fetch(endpoint,{
        method:'POST',
        headers:{'Content-Type':'application/json','x-goog-api-key':API_KEY},
        body:JSON.stringify({
          model,
          input:[
            {type:'text',text:prompt},
            {type:'document',data:String(pdfBase64),mime_type:'application/pdf'}
          ]
        }),
        signal:controller.signal
      });
    }finally{clearTimeout(timer)}
    const raw=await r.text();
    console.log('[AI native PDF]',JSON.stringify({model,retryAttempt,status:r.status,ms:Date.now()-started,pageNumber,pdfChars:String(pdfBase64).length}));
    if(!r.ok){
      const g=extractGoogleError(raw,r.status);
      console.error('[AI native PDF API error]',JSON.stringify({model,retryAttempt,error:g}));
      return send(res,r.status,{error:`Gemini native PDF API ${g.httpStatus}${g.status?' '+g.status:''}: ${g.message}`,google:g,provider:'gemini-interactions',model,retryAttempt});
    }
    let data;try{data=JSON.parse(raw)}catch(_){return send(res,502,{error:'Gemini native PDF returned invalid JSON.',model,retryAttempt,raw:raw.slice(0,2000)})}
    const texts=[];
    if(typeof data.output_text==='string')texts.push(data.output_text);
    for(const step of (Array.isArray(data.steps)?data.steps:[])){
      for(const part of (Array.isArray(step?.content)?step.content:[])){
        if(typeof part?.text==='string')texts.push(part.text);
      }
    }
    if(Array.isArray(data.outputs)){
      for(const out of data.outputs){
        if(typeof out?.text==='string')texts.push(out.text);
        for(const part of (Array.isArray(out?.content)?out.content:[]))if(typeof part?.text==='string')texts.push(part.text);
      }
    }
    const text=texts.join('').trim();
    if(!text)return send(res,502,{error:'Gemini native PDF returned no text output.',model,retryAttempt,raw:raw.slice(0,3000)});
    let parsed;
    try{parsed=JSON.parse(text)}catch(_){
      const cleaned=text.replace(/^\s*\`\`\`(?:json)?/i,'').replace(/\`\`\`\s*$/,'').trim();
      try{parsed=JSON.parse(cleaned)}catch(__){return send(res,502,{error:'Gemini native PDF returned invalid JSON.',model,retryAttempt,raw:text.slice(0,4000)})}
    }
    const extracted=Array.isArray(parsed)?parsed:(Array.isArray(parsed?.items)?parsed.items:(Array.isArray(parsed?.questions)?parsed.questions:[]));
    return send(res,200,{items:cleanQuestions(extracted),provider:'gemini-interactions',model,retryAttempt,pageNumber});
  }catch(e){
    console.error('[Gemini native PDF] exception',e);
    return send(res,e?.name==='AbortError'?504:500,{error:e?.name==='AbortError'?'Gemini native PDF request timed out.':'Gemini native PDF exception: '+(e?.message||'Unknown error'),type:e?.name||'Error',provider:'gemini-interactions',model,retryAttempt});
  }
}if(!pageText&&!imageDataUrl)return send(res,400,{error:'pageText or imageDataUrl is required.'});const image=parseImage(imageDataUrl);if(imageDataUrl&&!image)return send(res,400,{error:'Invalid imageDataUrl.'});if(image&&image.data.length>MAX_IMAGE_BASE64_CHARS)return send(res,413,{error:'Image payload is too large for Vercel/Gemini. The uploader must compress the page image before sending it.',imageChars:image.data.length,maxImageChars:MAX_IMAGE_BASE64_CHARS});let schema,prompt;if(mode==='detect_boxes'){if(!image)return send(res,400,{error:'detect_boxes requires imageDataUrl.'});schema=boxSchema;prompt='Inspect this full exam PDF page. Detect the complete question region and distinct solution region. Return normalized x,y,w,h from 0 to 1000. The question box must include the statement and all visible options and figures.';}else if(mode==='scan_questions'){if(!image)return send(res,400,{error:'scan_questions requires imageDataUrl.'});schema=scanSchema;prompt='Inspect the FULL rendered exam page and identify EVERY MCQ in reading order. The rendered image is authoritative. For EACH question, inspect the A, B, C and D regions separately. If all four are visibly present, ALL FOUR optA/optB/optC/optD fields are mandatory and must never be blank. Do not skip options because they wrap, are small, contain equations, Hindi/English text, or figures. Combine wrapped lines. If an option contains a figure, preserve any readable label/text and return its normalized option box. Return a questionBox covering the complete question and all options/figures. Return a solutionBox only for a distinct visible solution. Mathematical/scientific content MUST be returned as LaTeX so structure is preserved: inline \\( ... \\), display \\[ ... \\]. Preserve \\frac{a}{b}, \\sqrt{x}, powers x^2, subscripts x_1, vectors \\vec{E}, Greek letters, integrals, sums, limits, chemical notation, units, determinants and matrices such as \\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}. Never flatten fractions, matrices, superscripts or subscripts into approximate Unicode/plain text. Never invent unreadable content. Use the native PDF text only as a cross-check. Classify with existing paths ['+folders+']. If none fits, create a topic-based mainFolder/subFolder.';}else{schema=itemSchema;prompt=pageText ? 'Extract EVERY MCQ contained in the supplied native PDF text for THIS SINGLE PAGE. NATIVE PDF TEXT IS THE PRIMARY SOURCE; use it directly instead of asking Gemini to OCR an image. Preserve the exact wording and reading order. If an image is also supplied, use it only to verify layout, figures, equations or text that is missing from the native text. Carefully preserve scientific notation, stacked fractions, roots, superscripts, subscripts, vectors, Greek letters, signs, matrices and multi-line equations.' : 'Extract EVERY MCQ visible in this page. IMAGE IS AUTHORITATIVE. Carefully read scientific notation, stacked fractions, roots, superscripts, subscripts, vectors, Greek letters, signs, matrices and multi-line equations from the rendered image. NEVER represent mathematics as Python/programming code. Do not output ** for powers, sqrt(...) or math.sqrt(...), np.sqrt(...), programming operators, or code-like expressions. Convert mathematical expressions directly to LaTeX. For every question, inspect all four option areas independently and extract A, B, C and D whenever visible. Never skip a visible option because of small font, line wrapping, equations, Hindi/English, or a figure. If an option is primarily a figure, return its text/label plus an option box so the original figure can be preserved as an image crop. Return questionBox and solutionBox normalized 0-1000. Mathematical/scientific content MUST be returned as LaTeX so its structure survives extraction: inline \\( ... \\), display \\[ ... \\]. Preserve fractions, roots, powers, subscripts, vectors, Greek letters, integrals, sums, limits, chemical notation, units and matrices such as \\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}. Do not flatten equations to plain text. Never invent missing text. If native PDF text is supplied and contains no MCQ on this page, return an empty array. Because this endpoint may be called without an image, questionBox and solutionBox may be set to the full page {x:0,y:0,w:1000,h:1000} when exact coordinates cannot be known from text alone.'+' Choose the closest library path from ['+folders+'].';}
if(mode==='extract')prompt+='\\n\\nOUTPUT RULE: Return ONLY valid JSON. Return a JSON ARRAY of question objects. Do not wrap it in markdown, commentary, or a code fence. If no MCQ is visible, return [].';\nconst parts=[{text:prompt}];if(pageText)parts.push({text:'NATIVE PDF TEXT — PRIMARY SOURCE:\n'+pageText});if(image)parts.push({inline_data:{mime_type:image.mime,data:image.data}});
const retryAttempt=Number(body?.retryAttempt||0);
const geminiIndex=(Number.isFinite(retryAttempt)?retryAttempt:0);
const model=API_KEY ? GEMINI_MODELS[geminiIndex] : null;
const provider=model?'gemini':'openrouter';
if(!model && !OPENROUTER_API_KEY)return send(res,503,{error:'All configured Gemini fallbacks were exhausted. Add OPENROUTER_API_KEY to Vercel as an optional final free-router fallback.',provider:'fallback',retryAttempt,modelsTried:GEMINI_MODELS});
const endpoint=model
  ? 'https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent'
  : 'https://openrouter.ai/api/v1/chat/completions';
const started=Date.now();
try{
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),10000);
 let r;
 try{
  const requestBody=model
   ? {contents:[{role:'user',parts}],generationConfig:{responseMimeType:'application/json',maxOutputTokens:8192}}
   : {model:OPENROUTER_MODEL,messages:[{role:'user',content:parts.map(p=>p.inline_data?{type:'image_url',image_url:{url:'data:'+p.inline_data.mime_type+';base64,'+p.inline_data.data}}:{type:'text',text:p.text||''})}],response_format:{type:'json_object'},max_tokens:8192};
  const headers=model
   ? {'Content-Type':'application/json','x-goog-api-key':API_KEY}
   : {'Content-Type':'application/json','Authorization':'Bearer '+OPENROUTER_API_KEY,'HTTP-Referer':'https://atozexammocks.vercel.app','X-Title':'A to Z Exam Mocks AI Uploader'};
  r=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(requestBody),signal:controller.signal});
 }finally{clearTimeout(timer)}
 const raw=await r.text();
 console.log('[AI]',JSON.stringify({provider,model:model||OPENROUTER_MODEL,retryAttempt,status:r.status,ms:Date.now()-started,imageBytes:image?.data?.length||0,pageTextChars:String(pageText||'').length,contentLength}));
 if(!r.ok){
  const g=extractGoogleError(raw,r.status);
  console.error('[AI API error]',JSON.stringify({provider,model:model||OPENROUTER_MODEL,retryAttempt,status:r.status,error:g}));
  return send(res,r.status,{error:`${provider==='gemini'?'Gemini':'OpenRouter'} API ${g.httpStatus}${g.status?' '+g.status:''}: ${g.message}`,google:g,provider,model:model||OPENROUTER_MODEL,retryAttempt});
 }
 let data;try{data=JSON.parse(raw)}catch(_){return send(res,502,{error:'Gemini gateway returned invalid JSON.',model,retryAttempt,raw:raw.slice(0,1500)})}
 const text=model
  ? (data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'')
  : (data.choices?.[0]?.message?.content||'');
 if(!text)return send(res,502,{error:`${provider==='gemini'?'Gemini':'OpenRouter'} returned no result.`,provider,model:model||OPENROUTER_MODEL,retryAttempt,finishReason:data.candidates?.[0]?.finishReason||null});
 let parsed;try{parsed=JSON.parse(text)}catch(_){return send(res,502,{error:'Gemini returned invalid JSON.',model,retryAttempt,raw:text.slice(0,2000)})}
 if(mode==='detect_boxes')return send(res,200,{boxes:parsed,provider,model:model||OPENROUTER_MODEL});
 if(mode==='scan_questions')return send(res,200,{questions:cleanQuestions(Array.isArray(parsed)?parsed:parsed?.questions),provider,model:model||OPENROUTER_MODEL});
 const extracted=Array.isArray(parsed)?parsed:(Array.isArray(parsed?.items)?parsed.items:(Array.isArray(parsed?.questions)?parsed.questions:[]));
 return send(res,200,{items:cleanQuestions(extracted),provider,model:model||OPENROUTER_MODEL});
}catch(e){console.error('[Gemini] Server exception:',e);return send(res,e?.name==='AbortError'?504:500,{error:e?.name==='AbortError'?`${provider==='gemini'?'Gemini':'OpenRouter'} request timed out.`:(`${provider==='gemini'?'Gemini':'OpenRouter'} backend exception: `+(e?.message||'Unknown extraction error')),type:e?.name||'Error',provider,model:model||OPENROUTER_MODEL,retryAttempt});}}

// Final safety net: catches rejected promises or synchronous failures that escape the handler.
module.exports=(req,res)=>Promise.resolve().then(()=>handler(req,res)).catch((e)=>{
  console.error('[Gemini] UNHANDLED HANDLER FAILURE',e);
  return send(res,500,{error:'Gemini backend crashed before producing a normal response.',type:e?.name||'Error',detail:e?.message||'Unknown error'});
});