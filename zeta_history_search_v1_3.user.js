// ==UserScript==
// @name         Zeta 과거 대화 자동 검색 v1.3
// @namespace    local.zeta.history-search-v1-3
// @version      1.3.0
// @description  과거 대화 검색 및 텍스트 재확인 기반 결과 이동
// @match        https://zeta-ai.io/*
// @match        https://www.zeta-ai.io/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
  if (document.getElementById('zh-search-host-v13')) return;
  const host = document.createElement('div');
  host.id = 'zh-search-host-v13';
  document.documentElement.appendChild(host);
  const ui = host.attachShadow({mode:'open'});
  ui.innerHTML = `<style>
    *{box-sizing:border-box}button,input,select{font:inherit}
    #toggle{position:fixed;right:12px;bottom:120px;z-index:2147483647;border:0;border-radius:24px;background:#7040df;color:#fff;padding:12px 15px;font-size:14px;box-shadow:0 2px 12px #0008}
    #panel{display:none;position:fixed;z-index:2147483647;left:4vw;right:4vw;top:18vh;max-height:68vh;overflow:auto;background:#26212f;color:#fff;border-radius:16px;padding:16px;font:14px/1.5 sans-serif;box-shadow:0 4px 24px #000a}
    #heading{display:flex;align-items:center;justify-content:space-between;font-weight:bold;font-size:17px;margin-bottom:10px}#close{background:none;border:0;color:white;font-size:25px}
    #query{width:100%;background:#39333f;color:white;border:1px solid #777;border-radius:9px;padding:12px;font-size:16px}
    #controls{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}#controls button{border:0;border-radius:8px;background:#7040df;color:#fff;padding:9px 12px}#controls button:disabled{opacity:.45}
    #status{white-space:pre-wrap;color:#d1c7df;font-size:12px;margin:12px 0}#results{max-height:35vh;overflow:auto}.result{display:block;width:100%;text-align:left;background:#36303e;color:white;border:0;border-bottom:1px solid #5a5064;padding:11px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}
    #note{font-size:12px;color:#bbb;margin-top:8px}
  </style>
  <button id="toggle">🔍 과거 검색</button>
  <div id="panel"><div id="heading">제타 과거 대화 자동 검색 v1.3<button id="close">×</button></div>
  <input id="query" placeholder="검색할 대사 입력" autocomplete="off" />
  <div style="margin-top:10px;display:flex;align-items:center;gap:8px"><label for="speed">검색 속도</label><select id="speed" style="background:#39333f;color:white;border:1px solid #777;border-radius:8px;padding:8px"><option value="safe">안정</option><option value="balanced" selected>균형 (추천)</option><option value="fast">고속</option></select></div>
  <div id="controls"><button id="start">자동 검색</button><button id="stop" disabled>중단</button><button id="reset">결과 지우기</button></div>
  <div id="status">검색어를 입력하고 자동 검색을 누르세요.</div><div id="results"></div>
  <div id="note">속도는 이동 거리와 대기 시간을 조절합니다. 균형 모드는 화면의 약 95%씩 겹쳐 이동합니다. 고속 모드는 메시지 누락 위험이 더 높습니다. 과거 기록의 끝으로 추정되는 지점까지 자동 탐색합니다. 로딩 지연과 제타의 구조에 따라 일부 기록을 놓칠 수 있습니다. 안전을 위해 최대 3,000회 또는 45분에 종료합니다. 언제든 중단할 수 있습니다. 검색 내용은 외부로 별도 전송하거나 영구 저장하지 않습니다.</div></div>`;
  const $ = id => ui.getElementById(id);
  const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
  let running=false, cancel=false, matches=new Map(), target=null;
  const status = s => { $('status').textContent=s; };
  $('toggle').onclick=()=>{$('panel').style.display=$('panel').style.display==='block'?'none':'block';};
  $('close').onclick=()=>{$('panel').style.display='none';};
  $('stop').onclick=()=>{cancel=true;status('중단 요청 중…');};
  $('reset').onclick=()=>{if(running)return;matches.clear();$('results').replaceChildren();status('결과를 지웠습니다.');};
  function findChatScroller(){
    return [...document.querySelectorAll('div,main,section')].filter(el=>{
      const cs=getComputedStyle(el);
      return cs.overflowY==='auto'&&cs.flexDirection==='column-reverse'&&el.clientHeight>200&&el.scrollHeight>el.clientHeight+400;
    }).sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight))[0]||null;
  }
  function textCandidates(scroller){
    const walker=document.createTreeWalker(scroller,NodeFilter.SHOW_TEXT), nodes=[];let n;
    while((n=walker.nextNode())){
      const el=n.parentElement, value=n.textContent.trim();
      if(!el||value.length<2||value.length>12000||el.closest('script,style,textarea,input,button,[contenteditable="true"]'))continue;
      nodes.push({node:n,text:value});
    }
    return nodes;
  }
  function getMatch(scroller,entry){
    const candidates=textCandidates(scroller).filter(c=>c.text===entry.text);
    if(!candidates.length)return null;
    // 동일한 문장이 여럿이면 주변 문맥 비교. 구분 불가 시 첫 번째 항목을 사용.
    const scored=candidates.map(c=>{
      const near=(c.node.parentElement?.parentElement?.textContent||'').slice(0,1500);
      let score=0;
      if(entry.context&&near===entry.context)score+=3;
      if(entry.context&&near.includes(entry.context.slice(0,80)))score+=1;
      return {...c,score};
    }).sort((a,b)=>b.score-a.score);
    return scored[0];
  }
  function emphasize(el){
    const oldOutline=el.style.outline,oldBg=el.style.backgroundColor;
    el.scrollIntoView({block:'center',behavior:'auto'});
    el.style.outline='3px solid #a77aff';el.style.backgroundColor='rgba(113,55,255,.2)';
    setTimeout(()=>{if(el.isConnected){el.style.outline=oldOutline;el.style.backgroundColor=oldBg;}},5000);
  }
  function record(scroller,term){
    for(const {node,text} of textCandidates(scroller)){
      if(!text.toLocaleLowerCase().includes(term))continue;
      const context=(node.parentElement?.parentElement?.textContent||'').slice(0,1500);
      const key=text+'\u0000'+context;
      if(matches.has(key))continue;
      const entry={text,context,position:scroller.scrollTop};matches.set(key,entry);
      const item=document.createElement('button');item.className='result';
      const at=text.toLocaleLowerCase().indexOf(term),from=Math.max(0,at-70),to=Math.min(text.length,at+160);
      item.textContent=matches.size+'. '+(from?'…':'')+text.slice(from,to)+(to<text.length?'…':'');
      item.onclick=()=>navigate(entry);
      $('results').appendChild(item);
    }
  }
  async function navigate(entry){
    if(running){status('현재 작업이 끝난 뒤 결과를 선택해 주세요.');return;}
    target=findChatScroller();if(!target){status('채팅 스크롤 영역을 찾지 못했습니다.');return;}
    cancel=false;running=true;$('start').disabled=true;$('stop').disabled=false;
    try{
      // 현재 DOM에 있는 문장을 먼저 확인합니다. 이전에 저장한 노드나 좌표만 믿지 않습니다.
      let found=getMatch(target,entry);
      if(found){$('panel').style.display='none';emphasize(found.node.parentElement);return;}
      // 예전 좌표로 접근한 다음, 그 주변을 실제 문장으로 재확인합니다.
      target.scrollTop=entry.position;
      await wait(1000);
      found=getMatch(target,entry);
      if(found){$('panel').style.display='none';emphasize(found.node.parentElement);return;}
      // 제타의 동적 로딩으로 좌표가 달라질 수 있어, 최신 위치에서 과거 방향으로 재탐색합니다.
      // 단순 좌표 점프만 하고 성공했다고 말하지 않습니다.
      target.scrollTop=0;await wait(800);
      let stagnant=0;
      for(let i=1;i<=150&&!cancel;i++){
        found=getMatch(target,entry);
        if(found){$('panel').style.display='none';emphasize(found.node.parentElement);return;}
        const before=target.scrollTop;
        target.scrollTop=before-Math.max(250,Math.floor(target.clientHeight*.75));
        await wait(550);
        status(`선택한 대사 재탐색 중 ${i}/150회\n중단 버튼으로 취소할 수 있습니다.`);
        if(Math.abs(target.scrollTop-before)<2)stagnant++;else stagnant=0;
        if(stagnant>=6)break;
      }
      found=getMatch(target,entry);
      if(found){$('panel').style.display='none';emphasize(found.node.parentElement);return;}
      status(cancel?'대사 재탐색을 중단했습니다.':'해당 대사를 현재 불러올 수 있는 범위에서 다시 찾지 못했습니다. 잘못된 위치로 이동했다고 표시하지 않습니다.');
    }catch(e){status('이동 오류: '+String(e));}
    finally{running=false;$('start').disabled=false;$('stop').disabled=true;}
  }
  $('start').onclick=async()=>{
    if(running)return;
    const term=$('query').value.trim().toLocaleLowerCase();
    if(!term){status('검색어를 먼저 입력하세요.');return;}
    target=findChatScroller();if(!target){status('역방향 채팅 영역을 찾지 못했습니다.');return;}
    matches.clear();$('results').replaceChildren();cancel=false;running=true;
    $('start').disabled=true;$('stop').disabled=false;
    let stagnant=0,scanned=0,reason='';
    const mode=$('speed').value;
    const profiles={safe:{distance:.85,delay:850},balanced:{distance:.95,delay:400},fast:{distance:1.25,delay:260}};
    const profile=profiles[mode]||profiles.balanced;
    const began=Date.now(), maxSteps=3000, maxMs=45*60*1000;
    try{
      record(target,term);
      for(let i=1;i<=maxSteps&&!cancel;i++){
        if(Date.now()-began>maxMs){reason='45분 안전 제한에 도달했습니다.';break;}
        if(!target.isConnected){reason='채팅 영역이 변경됐습니다.';break;}
        const before=target.scrollTop, oldHeight=target.scrollHeight;
        target.scrollTop=before-Math.max(300,Math.floor(target.clientHeight*profile.distance));
        await wait(profile.delay);
        record(target,term);scanned=i;
        let after=target.scrollTop;
        let changed=Math.abs(after-before)>=2 || Math.abs(target.scrollHeight-oldHeight)>=2;
        if(!changed){
          // 네트워크로 이전 메시지가 로드될 시간을 줍니다.
          await wait(1200);
          record(target,term);
          changed=Math.abs(target.scrollTop-before)>=2 || Math.abs(target.scrollHeight-oldHeight)>=2;
        }
        stagnant=changed?0:stagnant+1;
        status(`과거 대화 탐색 중 · ${i}회 · 결과 ${matches.size}개\n속도 ${mode==='safe'?'안정':mode==='fast'?'고속':'균형'} · 스크롤 ${Math.round(before)} → ${Math.round(target.scrollTop)} · 정체 ${stagnant}/12\n중단 버튼으로 종료할 수 있습니다.`);
        if(stagnant>=12){reason='12회 연속 스크롤·높이 변화가 없어 과거 기록의 끝으로 추정됩니다.';break;}
        if(i===maxSteps)reason='3,000회 안전 제한에 도달했습니다.';
      }
      if(cancel)status(`사용자가 중단했습니다. ${scanned}회 탐색 · 결과 ${matches.size}개.`);
      else status(`${reason||'탐색을 종료했습니다.'}\n${scanned}회 탐색 · 결과 ${matches.size}개.\n전체 기록을 빠짐없이 검색했다고 보장할 수는 없습니다.`);
    }catch(e){status('검색 오류: '+String(e));}
    finally{running=false;$('start').disabled=false;$('stop').disabled=true;}
  };
})();
