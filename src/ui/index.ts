// Minimal, dependency-free HAL browser for the Pact broker.
// Rendered as HTML by the /ui route. Uses sessionStorage for the token
// so nothing leaves the browser tab.

export const HAL_BROWSER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Pact Broker — HAL browser</title>
<style>
  :root {
    color-scheme: light dark;
    --fg: #111; --bg: #fafafa; --muted: #666; --accent: #1a73e8; --panel: #fff;
    --border: #e2e2e2;
  }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #eee; --bg: #0f0f10; --muted: #aaa; --accent: #8ab4f8; --panel: #1a1a1c; --border: #2a2a2c; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; color: var(--fg); background: var(--bg); }
  header { padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  header h1 { margin: 0; font-size: 16px; }
  header input { flex: 1 1 320px; min-width: 240px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel); color: var(--fg); font: inherit; }
  header button { padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel); color: var(--fg); cursor: pointer; font: inherit; }
  main { display: grid; grid-template-columns: 320px 1fr; gap: 0; min-height: calc(100vh - 56px); }
  aside { border-right: 1px solid var(--border); padding: 12px 16px; background: var(--panel); overflow: auto; }
  section { padding: 12px 16px; overflow: auto; }
  aside h2, section h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); margin: 8px 0 6px; }
  a.link { color: var(--accent); cursor: pointer; text-decoration: none; display: block; padding: 4px 0; word-break: break-word; }
  a.link:hover { text-decoration: underline; }
  .rel { color: var(--muted); font-size: 12px; }
  pre { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 12px; font-size: 13px; margin: 0; overflow: auto; max-height: calc(100vh - 180px); }
  .status { margin-left: auto; color: var(--muted); font-size: 12px; }
  .err { color: #c00; }
  @media (max-width: 760px) { main { grid-template-columns: 1fr; } aside { border-right: 0; border-bottom: 1px solid var(--border); } }
</style>
</head>
<body>
<header>
  <h1>Pact Broker HAL browser</h1>
  <input id="path" value="/" aria-label="Path or URL" />
  <button id="go">Go</button>
  <button id="setToken">Set token</button>
  <button id="clearToken">Clear token</button>
  <span class="status" id="status"></span>
</header>
<main>
  <aside>
    <h2>Links</h2>
    <div id="links"></div>
    <h2>Embedded</h2>
    <div id="embedded"></div>
  </aside>
  <section>
    <h2>Response</h2>
    <pre id="body">(nothing loaded)</pre>
  </section>
</main>
<script>
(() => {
  const TOKEN_KEY = "pact-broker-hal-token";
  const path = document.getElementById("path");
  const go = document.getElementById("go");
  const setToken = document.getElementById("setToken");
  const clearToken = document.getElementById("clearToken");
  const status = document.getElementById("status");
  const linksEl = document.getElementById("links");
  const embeddedEl = document.getElementById("embedded");
  const bodyEl = document.getElementById("body");

  function getToken() { return sessionStorage.getItem(TOKEN_KEY) || ""; }
  function promptToken() {
    const current = getToken();
    const next = prompt("Bearer token (stays in this tab only)", current);
    if (next === null) return;
    if (next === "") sessionStorage.removeItem(TOKEN_KEY);
    else sessionStorage.setItem(TOKEN_KEY, next);
  }

  function renderLinks(container, obj) {
    container.textContent = "";
    if (!obj || typeof obj !== "object") { container.textContent = "(none)"; return; }
    const rels = Object.keys(obj);
    if (rels.length === 0) { container.textContent = "(none)"; return; }
    rels.sort();
    for (const rel of rels) {
      const value = obj[rel];
      const links = Array.isArray(value) ? value : [value];
      for (const l of links) {
        if (!l || !l.href) continue;
        const wrap = document.createElement("div");
        const relLabel = document.createElement("div");
        relLabel.className = "rel"; relLabel.textContent = rel + (l.title ? " — " + l.title : "");
        const a = document.createElement("a");
        a.className = "link"; a.textContent = l.href;
        a.addEventListener("click", (e) => { e.preventDefault(); load(l.href); });
        wrap.appendChild(relLabel); wrap.appendChild(a);
        container.appendChild(wrap);
      }
    }
  }

  function renderEmbedded(container, obj) {
    container.textContent = "";
    if (!obj || typeof obj !== "object") { container.textContent = "(none)"; return; }
    const rels = Object.keys(obj);
    if (rels.length === 0) { container.textContent = "(none)"; return; }
    for (const rel of rels) {
      const arr = Array.isArray(obj[rel]) ? obj[rel] : [obj[rel]];
      const h = document.createElement("div"); h.className = "rel"; h.textContent = rel + " (" + arr.length + ")";
      container.appendChild(h);
      for (const item of arr) {
        const self = item && item._links && item._links.self && item._links.self.href;
        if (!self) continue;
        const a = document.createElement("a"); a.className = "link"; a.textContent = self;
        a.addEventListener("click", (e) => { e.preventDefault(); load(self); });
        container.appendChild(a);
      }
    }
  }

  async function load(target) {
    const token = getToken();
    if (!token) { status.textContent = "No token set"; status.className = "status err"; return; }
    let url = target;
    try {
      if (target.startsWith("http://") || target.startsWith("https://")) {
        url = new URL(target).pathname + new URL(target).search;
      }
    } catch {}
    path.value = url;
    status.textContent = "Loading " + url + " …"; status.className = "status";
    try {
      const res = await fetch(url, { headers: { Authorization: "Bearer " + token, Accept: "application/json, application/hal+json" } });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch {}
      bodyEl.textContent = json ? JSON.stringify(json, null, 2) : (text || "(empty)");
      renderLinks(linksEl, json && json._links);
      renderEmbedded(embeddedEl, json && json._embedded);
      status.textContent = res.status + " " + res.statusText;
      status.className = res.ok ? "status" : "status err";
    } catch (e) {
      bodyEl.textContent = String(e);
      status.textContent = "Network error"; status.className = "status err";
    }
  }

  go.addEventListener("click", () => load(path.value || "/"));
  path.addEventListener("keydown", (e) => { if (e.key === "Enter") load(path.value || "/"); });
  setToken.addEventListener("click", promptToken);
  clearToken.addEventListener("click", () => { sessionStorage.removeItem(TOKEN_KEY); status.textContent = "Token cleared"; });

  if (!getToken()) { promptToken(); }
  load("/");
})();
</script>
</body>
</html>`;
