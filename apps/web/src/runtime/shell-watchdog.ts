/**
 * Inline script (see `app/layout.tsx`) that rescues a first load stuck on the
 * "Loading …" shell. After a deploy, one `/_next/` chunk can fail (5xx during
 * the container swap, or stale HTML naming a removed chunk); the bundler
 * runtime never retries a pre-rendered script whose error fired before it
 * attached, so the lazy `App` import never resolves. It must be inline, not a
 * module: the failing chunk could be the one that would carry it.
 *
 * Reloads once when a `/_next/` script/link fails to load, or when the app
 * still has not set `data-od-app-mounted` (App.tsx) 15 s after DOMContentLoaded.
 * `sessionStorage` blocks a second reload within 60 s; if storage is
 * unavailable it does nothing rather than risk a reload loop.
 */
export const SHELL_WATCHDOG_SCRIPT = `(function(){var d=document,n=0;function go(){if(n||d.documentElement.hasAttribute('data-od-app-mounted'))return;n=1;try{var k='od-shell-reload-at',t=+sessionStorage.getItem(k)||0;if(Date.now()-t<60000)return;sessionStorage.setItem(k,String(Date.now()));}catch(e){return;}location.reload();}window.addEventListener('error',function(e){var t=e.target;if(t&&(t.tagName==='SCRIPT'||t.tagName==='LINK')&&((t.src||t.href||'').indexOf('/_next/')>-1))go();},true);function arm(){setTimeout(go,15000);}if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',arm);else arm();})();`;
