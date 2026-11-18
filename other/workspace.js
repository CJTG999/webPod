/* webPod workspace visibility preferences */
(() => {
 const KEY='webPodWorkspace_v1';
 const defaults={hideVideoSettings:false,hideLyricTiming:false,showLyrics:true,showPlayer:true,showDashboard:true,showHeader:true};
 let prefs={...defaults};
 try{prefs={...prefs,...JSON.parse(localStorage.getItem(KEY)||'{}')};}catch(_){}
 const byId=id=>document.getElementById(id);
 const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(prefs));}catch(_){}};
 function apply(){
  byId('customVideoControls')?.classList.toggle('workspace-hidden',prefs.hideVideoSettings);
  byId('lyricOffsetControl')?.classList.toggle('workspace-hidden',prefs.hideLyricTiming);
  byId('lyricRateControl')?.classList.toggle('workspace-hidden',prefs.hideLyricTiming);
  [['panelLyrics',prefs.showLyrics],['panelIpod',prefs.showPlayer],['panelDashboard',prefs.showDashboard]].forEach(([id,on])=>byId(id)?.classList.toggle('workspace-hidden',!on));
  document.querySelector('body > header')?.classList.toggle('workspace-hidden',!prefs.showHeader);
  let quick=byId('workspaceQuickOpen');
  if(!quick){quick=document.createElement('button');quick.id='workspaceQuickOpen';quick.type='button';quick.textContent='Layout';quick.className='workspace-quick-open';quick.addEventListener('click',()=>byId('modalSettings')?.classList.remove('hidden'));document.body.appendChild(quick);}
  quick.classList.toggle('workspace-quick-visible',!prefs.showHeader);
  const ids=['settingHideVideo','settingHideLyricTiming','layoutShowLyrics','layoutShowPlayer','layoutShowDashboard','layoutShowHeader'];
  const values=[prefs.hideVideoSettings,prefs.hideLyricTiming,prefs.showLyrics,prefs.showPlayer,prefs.showDashboard,prefs.showHeader];
  ids.forEach((id,i)=>{const el=byId(id);if(el)el.checked=values[i];});
 }
 function wire(id,key){const el=byId(id);if(!el)return;el.addEventListener('change',()=>{prefs[key]=el.checked;save();apply();});}
 document.addEventListener('DOMContentLoaded',()=>{
  wire('settingHideVideo','hideVideoSettings');wire('settingHideLyricTiming','hideLyricTiming');
  wire('layoutShowLyrics','showLyrics');wire('layoutShowPlayer','showPlayer');wire('layoutShowDashboard','showDashboard');wire('layoutShowHeader','showHeader');
  byId('btnResetWorkspace')?.addEventListener('click',()=>{prefs={...defaults};save();apply();});
  apply();
 });
 window.webPodWorkspacePrefs=()=>({...prefs});
 window.webPodApplyWorkspacePrefs=next=>{prefs={...defaults,...(next||{})};save();apply();};
})();
