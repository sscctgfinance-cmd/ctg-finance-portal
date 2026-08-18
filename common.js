// Shared by app.html (Finance OS) and hros.html (HR OS).
//
// Every function below was byte-identical in both files; a fix to one had to be repeated in the other or
// the two silently drifted. Moved here verbatim — no behaviour change.
//
// This MUST stay a classic script (<script src="common.js">, never type="module"), loaded BEFORE each
// file's inline <script>. The apps wire ~450 inline onclick="..." handlers, which resolve names as
// globals at click time; a module's top-level declarations are not global and every one of these would
// be undefined.
//
// Several of these read per-app state that stays in each file's inline script — API, CTG_SSO, TOKEN,
// STORAGE_OK, ME, COMPANIES, TFA_TOKEN, _toastQueue/_toastPlaying, SESSION_EXPIRED_SHOWN — and call
// per-app functions that legitimately differ (enterApp, show2faPrompt, handleSessionExpired). That is
// safe because nothing here runs at load time: a classic script's top-level const/let live in the shared
// global lexical environment, so each name is resolved when the function is CALLED, by which point the
// inline script has run. Do not add load-time code to this file.

function ctgSsoSignIn(app){ location.href = CTG_SSO + "/start?app=" + encodeURIComponent(app); }
function storageGet(k){ try { return STORAGE_OK ? localStorage.getItem(k) : null; } catch(_e){ return null; } }
function storageSet(k,v){ try { if(STORAGE_OK) localStorage.setItem(k,v); } catch(_e){} }
function storageRemove(k){ try { if(STORAGE_OK) localStorage.removeItem(k); } catch(_e){} }
function localISO(d){ const p=n=>String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
function inDaysLocalISO(days){ const d=new Date(); d.setDate(d.getDate()+days); return localISO(d); }
function toast(msg,isErr){ _toastQueue.push({msg,isErr}); if(!_toastPlaying) _playNextToast(); }
function _playNextToast(){
  const next=_toastQueue.shift();
  if(!next){ _toastPlaying=false; return; }
  _toastPlaying=true;
  const e=document.getElementById('toast');
  e.textContent=next.msg;
  e.style.borderColor=next.isErr?'rgba(239,68,68,.45)':'';
  e.style.color=next.isErr?'var(--red-soft)':'';
  e.classList.add('show');
  setTimeout(()=>{ e.classList.remove('show'); setTimeout(_playNextToast, 240); }, 2400);
}
async function call(body){
  const reqToken = body && body.token !== undefined ? body.token : TOKEN;
  // Don't make calls after we already know the session is dead — except for login/me probes.
  const isAuthExempt = body && (body.api==='login' || body.api==='login_2fa');
  for(let attempt=0; attempt<2; attempt++){
    const ctrl=new AbortController();
    const tm=setTimeout(()=>ctrl.abort(),30000);
    try{
      const r=await fetch(API,{method:'POST',body:JSON.stringify(Object.assign({token:TOKEN},body)),signal:ctrl.signal});
      // Retry once on transient 5xx
      if((r.status===502||r.status===503||r.status===504) && attempt===0){
        clearTimeout(tm);
        await new Promise(rs=>setTimeout(rs, 1000));
        continue;
      }
      let data; try{ data=await r.json(); }catch(_e){
        if(r.status>=500) throw new Error('Server returned an unexpected response — please retry');
        throw new Error('Server returned an unexpected response');
      }
      // Session-expired detection: if we had a token and the server says unauthorized → token died.
      const isUnauth = (r.status===401) || (data && data.ok===false && data.error==='unauthorized');
      if(isUnauth && reqToken && !isAuthExempt){
        handleSessionExpired();
        // Throw so callers don't try to render data; the modal will guide the user.
        throw new Error('Session expired — please sign in again');
      }
      if(!r.ok && data && data.error) throw new Error(data.error);
      return data;
    }catch(e){
      if(e && e.name==='AbortError') throw new Error('Request timed out — server or Xero is slow, please retry');
      if(e instanceof TypeError) throw new Error('Network error — check your connection and retry');
      throw e;
    }finally{clearTimeout(tm);}
  }
}
async function doLogin(e){
  e.preventDefault();
  const email=document.getElementById('email').value.trim();
  const pass=document.getElementById('pass').value;
  const b=document.getElementById('lbtn'),er=document.getElementById('lerr');
  er.classList.add('hide');b.disabled=true;b.textContent='Signing in…';
  try{
    const r=await call({api:'login',email,pass,token:''});
    if(r&&r.ok){TOKEN=r.token;storageSet('ctg_portal_token',TOKEN);ME=r.user;COMPANIES=r.companies||[];enterApp();return;}
    if(r&&r.need_2fa){ show2faPrompt(r.login_token); b.disabled=false; b.textContent='Sign In'; return; }
    if(r&&r.locked){er.textContent='🔒 Account locked after too many failed attempts. Try again in '+(r.retry_minutes||15)+' min.';}
    else er.textContent='Incorrect email or password';
    er.classList.remove('hide');
  }catch(x){er.textContent='Connection failed, please retry';er.classList.remove('hide');}
  b.disabled=false;b.textContent='Sign In';
}
function cancel2fa(){ TFA_TOKEN=null; var o=document.getElementById('tfa_overlay'); if(o) o.remove(); document.getElementById('login').classList.remove('hide'); }
async function submit2fa(){
  var er=document.getElementById('tfa_err'); var btn=document.getElementById('tfa_btn');
  var code=(document.getElementById('tfa_code').value||'').replace(/\s|-/g,'');
  er.classList.add('hide');
  if(!/^\d{6}$/.test(code)){ er.textContent='Enter the 6-digit code from your authenticator app'; er.classList.remove('hide'); return; }
  btn.disabled=true; btn.textContent='Verifying…';
  try{
    var r=await call({api:'login_2fa', login_token:TFA_TOKEN, code:code, token:''});
    if(r&&r.ok){
      TOKEN=r.token; storageSet('ctg_portal_token',TOKEN); ME=r.user; COMPANIES=r.companies||[];
      var o=document.getElementById('tfa_overlay'); if(o) o.remove();
      enterApp(); return;
    }
    er.textContent=(r&&r.error)||'Incorrect code'; er.classList.remove('hide');
  }catch(x){ er.textContent='Network error, please retry'; er.classList.remove('hide'); }
  btn.disabled=false; btn.textContent='Verify';
}
