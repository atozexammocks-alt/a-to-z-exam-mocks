from pathlib import Path
p=Path('ai_uploader.html')
s=p.read_text()
s=s.replace('async async function getPageImage(n)', 'async function getPageImage(n)')
start=s.find('<script>/* A2Z_PAGEWISE_KEEP_V1 */')
if start < 0: raise SystemExit('V1 marker not found')
end=s.find('</script>', start)
if end < 0: raise SystemExit('script end not found')
new='''<script>/* A2Z_PAGEWISE_KEEP_V2 */
(function(){
  const listEl=document.getElementById('list');
  let selected='all',busy=false;
  function decorate(){
    if(busy||!listEl||!Array.isArray(window.items))return;
    busy=true;
    try{
      const cards=[...listEl.querySelectorAll('.q')], pages=[];
      cards.forEach((card,i)=>{
        const x=window.items[i]; if(!x)return;
        if(x.keepText===undefined)x.keepText=true;
        if(x.keepQuestionImage===undefined)x.keepQuestionImage=true;
        const page=Number(x.sourcePage||x.pageNumber||x.page||x.source_page||1);
        card.dataset.pdfPage=page;
        if(!pages.includes(page))pages.push(page);
        let bar=card.querySelector('.a2zExternalKeep');
        if(!bar){bar=document.createElement('div');bar.className='a2zExternalKeep';card.insertBefore(bar,card.firstElementChild)}
        bar.innerHTML='<b>Page '+page+' · Q'+(x.qNo||i+1)+'</b><button type="button">'+(x.keepText?'✓ Keep Text':'☐ Keep Text')+'</button><button type="button">'+(x.keepQuestionImage?'✓ Keep Image':'☐ Keep Image')+'</button><button type="button">'+(x.keepText&&x.keepQuestionImage?'✓ Keep Question':'↩ Unkeep Question')+'</button>';
        const bs=bar.querySelectorAll('button');
        bs[0].onclick=()=>{x.keepText=!x.keepText;decorate()};
        bs[1].onclick=()=>{x.keepQuestionImage=!x.keepQuestionImage;decorate()};
        bs[2].onclick=()=>{const on=!(x.keepText&&x.keepQuestionImage);x.keepText=on;x.keepQuestionImage=on;decorate()};
      });
      pages.sort((a,b)=>a-b);
      let nav=document.getElementById('a2zPageNav');
      if(!nav){nav=document.createElement('div');nav.id='a2zPageNav';listEl.parentElement.insertBefore(nav,listEl)}
      nav.innerHTML='<b>PDF Pages:</b><button type="button" data-p="all">All ('+cards.length+')</button>'+pages.map(p=>'<button type="button" data-p="'+p+'">Page '+p+' ('+cards.filter(c=>Number(c.dataset.pdfPage)===p).length+')</button>').join('');
      nav.querySelectorAll('button').forEach(b=>b.onclick=()=>{selected=b.dataset.p;decorate()});
      cards.forEach(c=>c.style.display=(selected==='all'||String(c.dataset.pdfPage)===String(selected))?'':'none');
    }finally{busy=false}
  }
  const style=document.createElement('style');style.textContent='#a2zPageNav{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:10px 0;padding:9px;background:#07111f;border:1px solid #164e63;border-radius:8px}#a2zPageNav button,.a2zExternalKeep button{background:#1e293b;color:#fff;border:1px solid #334155;border-radius:6px;padding:6px 9px;font-weight:800;cursor:pointer}.a2zExternalKeep{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:7px 0;padding:7px;border:1px solid #164e63;border-radius:8px;background:#07111f}.a2zExternalKeep b{color:#67e8f9}.a2zExternalKeep button:hover,#a2zPageNav button:hover{background:#0284c7}';document.head.appendChild(style);
  const obs=new MutationObserver(()=>setTimeout(decorate,0));if(listEl)obs.observe(listEl,{childList:true});addEventListener('load',()=>setTimeout(decorate,500));setInterval(()=>{if(!busy)decorate()},1200);
})();</script>'''
s=s[:start]+new+s[end+9:]
p.write_text(s)
