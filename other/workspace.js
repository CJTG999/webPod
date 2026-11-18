/* webPod workspace/video timing preferences */
(() => {
 const KEY='webPodWorkspace_v1';
 const defaults={hideVideoSettings:false,hideLyricTiming:false,showLyrics:true,showPlayer:true,showDashboard:true,showHeader:true};
 let prefs={...defaults};
 try{prefs={...prefs,...JSON.parse(localStorage.getItem(KEY)||'{}')};}catch(_){}
 const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(prefs));}catch(_){}};
 const byId=id=>document.getElementById(id);
 function apply(){
  byId('customVideoControls')?.classList.toggle('workspace-hidden',prefs.hideVideoSettings);
  byId('lyricOffsetControl')?.classList.toggle('workspace-hidden',prefs.hideLyricTiming);
  byId('lyricRateControl')?.classList.toggle('workspace-hidden',prefs.hideLyricTiming);
  const map=[['panelLyrics',prefs.showLyrics],['panelIpod',prefs.showPlayer],['panelDashboard',prefs.showDashboard]];
  map.forEach(([id,on])=>{const el=byId(id);if(el)el.classList.toggle('workspace-hidden',!on);});
  document.querySelector('header')?.classList.toggle('workspace-hidden',!prefs.showHeader);
  let quick=byId('workspaceQuickOpen');if(!quick){quick=document.createElement('button');quick.id='workspaceQuickOpen';quick.type='button';quick.textContent='Layout';quick.className='workspace-quick-open';quick.addEventListener('click',()=>byId('modalSettings')?.classList.remove('hidden'));document.body.appendChild(quick);}quick.classList.toggle('workspace-quick-visible',!prefs.showHeader);
  ['settingHideVideo','settingHideLyricTiming','layoutShowLyrics','layoutShowPlayer','layoutShowDashboard','layoutShowHeader'].forEach((id,i)=>{const el=byId(id);if(el)el.checked=[prefs.hideVideoSettings,prefs.hideLyricTiming,prefs.showLyrics,prefs.showPlayer,prefs.showDashboard,prefs.showHeader][i];});
 }
 function wire(id,key){const el=byId(id);if(!el)return;el.addEventListener('change',()=>{prefs[key]=el.checked;save();apply();});}
 function videoOffset(){const v=byId('customVideo'),s=byId('sliderVideoOffset'),t=byId('txtVideoOffset');if(!s)return;const n=Number(s.value||0);if(t)t.textContent=(n>0?'+':'')+n.toFixed(1)+'s';if(v&&window.webPodAudioElement)v.currentTime=Math.max(0,window.webPodAudioElement.currentTime+n);}
 document.addEventListener('DOMContentLoaded',()=>{
  wire('settingHideVideo','hideVideoSettings');wire('settingHideLyricTiming','hideLyricTiming');wire('layoutShowLyrics','showLyrics');wire('layoutShowPlayer','showPlayer');wire('layoutShowDashboard','showDashboard');wire('layoutShowHeader','showHeader');
  byId('btnResetWorkspace')?.addEventListener('click',()=>{prefs={...defaults};save();apply();});
  const slider=byId('sliderVideoOffset');if(slider){slider.value='0';slider.addEventListener('input',videoOffset);slider.addEventListener('change',async()=>{const id=window.webPodCurrentTrackId;if(!id)return;try{const req=indexedDB.open('webPodMemoryDB',1);req.onsuccess=()=>{const db=req.result,tx=db.transaction('tracks','readwrite'),st=tx.objectStore('tracks'),g=st.get(id);g.onsuccess=()=>{if(g.result){g.result.videoOffset=Number(slider.value);st.put(g.result);}};};}catch(_){}});}
  apply();
 });
 window.webPodWorkspacePrefs=()=>({...prefs});
 window.webPodApplyWorkspacePrefs=next=>{prefs={...defaults,...(next||{})};save();apply();};
})();
