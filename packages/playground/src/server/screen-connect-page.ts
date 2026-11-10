/** The original QR-first page entry: one stable browser identity per piece of glass. */
export function screenConnectPage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="apple-mobile-web-app-capable" content="yes"><title>Midscene · Connect Screen</title><style>body{font:16px -apple-system,BlinkMacSystemFont,sans-serif;display:grid;place-content:center;min-height:90vh;padding:24px;background:#fff;color:#162331}main{max-width:360px;display:grid;gap:16px}p{line-height:1.6}</style></head><body><main><h2>Midscene · 屏幕连接</h2><p id="status">正在连接屏幕… / Connecting screen…</p></main><script>
let pageKey,token;try{token=localStorage.getItem('midscene-screen-page-token');pageKey=localStorage.getItem('midscene-screen-page-key');if(!pageKey){pageKey=crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16)});localStorage.setItem('midscene-screen-page-key',pageKey)}}catch{pageKey=null}
const status=document.getElementById('status');
async function connect(){try{if(!pageKey)throw new Error('请允许浏览器保存本地数据 / Allow browser storage');const ticket=new URLSearchParams(location.hash.slice(1)).get('bind');const response=await fetch('/phone-calibration/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket,pageKey,token,browserPlatform:navigator.userAgentData?.platform})});const data=await response.json();if(!response.ok)throw new Error(data.error||'连接失败 / Connection failed');location.replace(data.url)}catch(error){status.textContent=error.message}}
connect();
</script></body></html>`;
}
