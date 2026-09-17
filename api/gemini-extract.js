const MODELS=['gemini-3.8-flash','gemini-3.7-flash','gemini-3.6-flash','gemini-3.5-flash','gemini-3.5-flash-lite','gemini-3.1-flash-lite','gemini-3.1-pro-preview','gemini-3-flash-preview','gemini-2.5-pro','gemini-2.5-flash','gemini-2.5-flash-lite','gemini-2.5-flash-preview-05-20','gemini-2.5-flash-preview-09-25','gemini-2.0-flash','gemini-2.0-flash-001','gemini-2.0-flash-lite','gemini-2.0-flash-lite-001','gemini-2.0-pro-exp','gemini-2.0-pro-exp-02-05','gemini-2.0-flash-exp','gemini-1.5-pro','gemini-1.5-flash','gemini-1.5-flash-8b','gemini-3.8-flash','gemini-3.7-flash','gemini-3.6-flash','gemini-3.5-flash','gemini-3.5-flash-lite','gemini-3.1-flash-lite','gemini-3.1-pro-preview','gemini-3-flash-preview','gemini-2.5-pro','gemini-2.5-flash','gemini-2.5-flash-lite','gemini-2.5-flash-preview-05-20','gemini-2.5-flash-preview-09-25','gemini-2.0-flash','gemini-2.0-flash-001','gemini-2.0-flash-lite','gemini-2.0-flash-lite-001','gemini-2.0-pro-exp','gemini-2.0-pro-exp-02-05','gemini-2.0-flash-exp','gemini-1.5-pro','gemini-1.5-flash','gemini-1.5-flash-8b'];
const API_KEY=process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY||'';
const box={type:'object',properties:{x:{type:'number'},y:{type:'number'},w:{type:'number'},h:{type:'number'}},required:['x','y','w','h']};
const opt={type:'object',properties:{text:{type:'string'},box},required:['text','box']};
const schema={type:'array',items:{type:'object',properties:{qNo:{type:'integer'},qText:{type:'string'},qTextEnglish:{type:'string'},qTextHindi:{type:'string'},optA:opt,optB:opt,optC:opt,optD:opt,key:{type:'string'},topic:{type:'string'},targetPath:{type:'string'},questionBox:box,solutionBox:box,continuesToNextPage:{type:'boolean'},nextPageBox:box},required:['qNo','qText','optA','optB','optC','optD','key','topic','targetPath','questionBox','solutionBox','continuesToNextPage']}};
const send=(r,s,b)=>r.status(s).setHeader('Content-Type','application/json').send(JSON.stringify(b));
const img=s=>{const m=String(s||'').match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i);return m?{mime:m[1].toLowerCase().replace('jpg','jpeg'),data:m[2]}:null};
const clean=s=>typeof s==='string'?s.replace(/[ 	]{2,}/g,' ').trim():s;
const cleanItems=a=>Array.isArray(a)?a.map(q=>{if(q)for(const k of ['qText','qTextEnglish','qTextHindi','key','topic','targetPath'])if(typeof q[k]==='string')q[k]=clean(q[k]);for(const k of ['optA','optB','optC','optD'])if(q?.[k]?.text)q[k].text=clean(q[k].text);return q}):[];
module.exports=async(req,res)=>{
if(req.method!=='POST')return send(res,405,{error:'POST only'});
if(!API_KEY)return send(res,500,{error:'Gemini API key is not configured.'});
try{
const{pageText='',imageDataUrl='',nextPageText='',nextImageDataUrl='',pageNumber=null,nextPageNumber=null,folders=''}=req.body||{};
if(!pageText&&!imageDataUrl)return send(res,400,{error:'pageText or imageDataUrl is required.'});
const image=img(imageDataUrl),nextImage=img(nextImageDataUrl);
if(imageDataUrl&&!image)return send(res,400,{error:'Invalid imageDataUrl.'});
if(nextImageDataUrl&&!nextImage)return send(res,400,{error:'Invalid nextImageDataUrl.'});
if(image&&image.data.length>3800000)return send(res,413,{error:'Image payload too large.'});
if(nextImage&&nextImage.data.length>3000000)return send(res,413,{error:'Next page image payload too large.'});
const parts=[{text:`Extract EVERY MCQ whose question STARTS on PDF page ${pageNumber||'current'}. IMAGE IS AUTHORITATIVE. Read the question and ALL visible A/B/C/D options independently, including Hindi/English, equations and figures. Preserve scientific mathematics EXACTLY as mathematics.\n\nMATHEMATICAL OCR RULES — CRITICAL:\n1) NEVER spell mathematical symbols as words when a mathematical symbol exists. Use LaTeX notation.\n2) Greek letters: use \\sigma, \\rho, \\mu, \\epsilon, \\alpha, \\beta, \\gamma, \\lambda, \\omega, etc.\n3) Subscripts/superscripts MUST be preserved: R_H, V_0, x^2, m_e, k_B, 10^{-3}.\n4) Fractions MUST be \\frac{a}{b}; roots \\sqrt{x}; sums \\sum_{i=1}^{n}; integrals \\int; vectors may use \\vec{E}; units may remain plain text.\n5) Physics quantities such as Hall coefficient must appear as R_H, refractive index as n, resistivity as \\rho, conductivity as \\sigma, wavelength as \\lambda, permeability as \\mu, permittivity as \\epsilon, Planck constant as h, reduced Planck constant as \\hbar when indicated.\n6) Keep equations wrapped in \\(...\\) for inline math or \\[...\\] for display math. Do NOT convert LaTeX into plain words.\n7) Preserve uppercase/lowercase exactly where scientifically meaningful.\n8) Options must receive the same mathematical treatment.\nReturn qText, qTextEnglish and qTextHindi with LaTeX preserved. qText should prefer the source's original language/bilingual form. NEVER output Python, JavaScript, Markdown code fences, OCR program text, or extraction explanations; output only question content. If a mathematical symbol is visible, transcribe it as LaTeX rather than a programming expression or English word. Preserve line breaks between separate printed lines. Also return normalized questionBox and solutionBox 0-1000. Closest library path: [${folders}].`},{text:'IMPORTANT CROSS-PAGE RULE: If a question starts on the current page but its statement, options, figure, or solution visibly continues onto the NEXT page, set continuesToNextPage=true and return nextPageBox as the 0-1000 rectangle on the next-page image containing the continuation. Do NOT treat a brand-new question that starts on the next page as continuation. Only mark continuation when the current question clearly continues across the page break.'}];
if(pageText)parts.push({text:'Current PDF text cross-check only:\n'+String(pageText).slice(0,12000)});
if(nextPageText)parts.push({text:`Next PDF page ${nextPageNumber||''} text for continuation checking only:\n`+String(nextPageText).slice(0,9000)});
if(image)parts.push({inline_data:{mime_type:image.mime,data:image.data}});
if(nextImage)parts.push({inline_data:{mime_type:nextImage.mime,data:nextImage.data}});
let last=null;
for(const model of MODELS){
try{
const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':API_KEY},body:JSON.stringify({contents:[{role:'user',parts}],generationConfig:{responseMimeType:'application/json',responseSchema:schema,temperature:.03,maxOutputTokens:8192}})});
const raw=await r.text();
if(!r.ok){let g={httpStatus:r.status,message:'Gemini API request failed',raw:raw.slice(0,2500)};try{const j=JSON.parse(raw);g={...g,code:j.error?.code,status:j.error?.status,message:j.error?.message||g.message,details:j.error?.details||[]}}catch(_){}last={model,google:g};if([400,404,408,409,429,500,502,503,504].includes(r.status))continue;return send(res,r.status,{error:g.message,google:g,model})}
let j;try{j=JSON.parse(raw)}catch(_){last={model,message:'Invalid JSON'};continue}
const text=j.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';if(!text){last={model,message:'Gemini returned no content'};continue}
try{return send(res,200,{items:cleanItems(JSON.parse(text)),model})}catch(_){last={model,message:'Invalid structured JSON'}}
}catch(e){last={model,message:e.message||'Network error'}}
}
return send(res,last?.google?.httpStatus||503,{error:'All Gemini models failed.',google:last?.google||null,triedModels:MODELS,model:last?.model||null})
}catch(e){return send(res,500,{error:e.message||'Unknown extraction error'})}
};