import {
  midscenePhoneLogo,
  phoneConnectionBrandStyles,
} from '@midscene/robotics-vision/phone/brand';

/** The original QR-first page entry: one stable browser identity per piece of glass. */
export function screenConnectPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-capable" content="yes"><title>Midscene · Connect Screen</title><style>*{box-sizing:border-box}body{margin:0;font:15px/1.65 system-ui,sans-serif;display:grid;align-content:center;min-height:100vh;min-height:100dvh;padding:28px;background:#fff;color:#20251f}main{width:100%;max-width:450px;margin:auto}h1{margin:0 0 12px;font-size:clamp(24px,7vw,34px);letter-spacing:-.04em;line-height:1.2}p{margin:0;color:#515a51}${phoneConnectionBrandStyles}</style></head><body><div id="midscene-phone-brand">${midscenePhoneLogo}Midscene</div><main><h1>Connect screen</h1><p id="status" role="status">Connecting screen…</p></main><script>
let pageKey,token;try{token=localStorage.getItem('midscene-screen-page-token');pageKey=localStorage.getItem('midscene-screen-page-key');if(!pageKey){pageKey=crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16)});localStorage.setItem('midscene-screen-page-key',pageKey)}}catch{pageKey=null}
const status=document.getElementById('status');
async function connect(){try{if(!pageKey)throw new Error('Allow browser storage to connect this screen.');const ticket=new URLSearchParams(location.hash.slice(1)).get('bind');const response=await fetch('/phone-calibration/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket,pageKey,token,browserPlatform:navigator.userAgentData?.platform})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Connection failed');location.replace(data.url)}catch(error){status.textContent=error.message}}
connect();
</script></body></html>`;
}
