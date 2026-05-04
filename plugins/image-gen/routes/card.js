/**
 * image-gen/routes/card.js
 *
 * Iframe card for generated media. The card only renders bounded thumbnails in
 * chat; opening the original media is delegated to the host media viewer.
 */
import path from "node:path";

const MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  ogg: "audio/ogg",
};

const VIDEO_EXTS = new Set(["mp4", "mov", "webm"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "m4a", "aac", "flac", "ogg"]);

export default function (app, ctx) {
  app.get("/card", (c) => {
    const batchId = c.req.query("batch");
    if (!batchId) return c.text("Missing batch parameter", 400);

    const store = ctx._mediaGen?.store;
    const tasks = store?.getByBatch(batchId) || [];
    const token = c.req.query("token") || "";
    const pluginId = ctx.pluginId;
    const mediaBase = `/api/plugins/${pluginId}`;
    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : "";
    const hanaCss = c.req.query("hana-css") || "";

    const hasPending = tasks.some((t) => t.status === "pending");
    const firstType = tasks[0]?.type || tasks[0]?.params?.type || "image";
    const ratio = tasks[0]?.params?.ratio || (firstType === "audio" || firstType === "music" ? "4:1" : "1:1");
    const [rw, rh] = ratio.split(":").map(Number);
    const cssRatio = (rw && rh) ? `${rw}/${rh}` : "1/1";
    const pollApi = `${mediaBase}/tasks/batch/${encodeURIComponent(batchId)}${tokenParam}`;

    function filePayload(file) {
      const ext = path.extname(file).slice(1).toLowerCase();
      const kind = VIDEO_EXTS.has(ext) ? "video" : AUDIO_EXTS.has(ext) ? "audio" : "image";
      return {
        fileName: file,
        name: file,
        path: path.join(ctx.dataDir, "generated", file),
        kind,
        ext,
        mime: MIME[ext] || (kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : "image/png"),
        url: `${mediaBase}/media/${encodeURIComponent(file)}${tokenParam}`,
        downloadUrl: `${mediaBase}/media/download/${encodeURIComponent(file)}${tokenParam}`,
      };
    }

    function renderCellInner(t) {
      if (t.status === "done" && t.files?.length) {
        return renderMedia(filePayload(t.files[0]));
      }
      if (t.status === "failed") {
        return `<div class="failed">${esc(t.failReason || "生成失败")}</div>`;
      }
      return `<div class="skeleton" aria-label="生成中"></div>`;
    }

    let cellsHtml = "";
    for (const t of tasks) {
      const state = t.status || "pending";
      cellsHtml += `<div class="cell" data-task-id="${escAttr(t.taskId)}" data-state="${escAttr(state)}">${renderCellInner(t)}</div>`;
    }

    if (!tasks.length) cellsHtml = `<div class="failed">任务不存在</div>`;

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
${hanaCss ? `<link rel="stylesheet" href="${escAttr(hanaCss)}">` : ""}
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{color-scheme:light}
html,body{width:100%;max-width:100%;overflow:auto}
body{background:var(--bg-card,#FCFAF5);padding:8px;font-family:var(--font-sans,system-ui,sans-serif);color:var(--text,#292522)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:8px;width:100%;max-width:100%}
.cell{min-width:0;max-width:100%}
.media-card{width:100%;max-width:100%;overflow:hidden;border:1px solid color-mix(in srgb,var(--border,#ddd) 78%,transparent);border-radius:12px;background:color-mix(in srgb,var(--bg,#fff) 92%,transparent);box-shadow:0 4px 14px rgba(0,0,0,.07)}
.preview{display:flex;align-items:center;justify-content:center;width:100%;aspect-ratio:${cssRatio};max-height:360px;border:0;background:linear-gradient(180deg,rgba(255,255,255,.65),rgba(255,255,255,.2));cursor:zoom-in;overflow:hidden}
.preview.audio-preview{cursor:default;padding:16px;min-height:92px}
.preview img,.preview video{display:block;width:100%;height:100%;max-width:100%;max-height:360px;object-fit:contain}
.preview audio{width:100%;max-width:100%}
.actions{display:flex;align-items:center;justify-content:flex-end;gap:6px;padding:7px;border-top:1px solid color-mix(in srgb,var(--border,#ddd) 62%,transparent)}
.action{display:inline-flex;align-items:center;justify-content:center;min-height:28px;padding:0 10px;border-radius:999px;border:1px solid color-mix(in srgb,var(--accent,#8A6F4D) 24%,var(--border,#ddd));background:color-mix(in srgb,var(--bg,#fff) 86%,transparent);color:var(--text,#292522);font:600 12px/1 var(--font-sans,system-ui,sans-serif);text-decoration:none;cursor:pointer}
.action:hover{background:color-mix(in srgb,var(--accent,#8A6F4D) 12%,var(--bg,#fff))}
.skeleton{aspect-ratio:${cssRatio};max-height:360px;background:linear-gradient(90deg,#f0ede8 25%,#e8e4de 50%,#f0ede8 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;border-radius:12px}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.failed{padding:12px;color:#b23b32;font-size:12px;line-height:1.5}
</style></head>
<body><div class="grid">${cellsHtml}</div>
<script>
(function(){
  var pollApi = ${JSON.stringify(pollApi)};
  var mediaBase = ${JSON.stringify(mediaBase)};
  var tokenParam = ${JSON.stringify(tokenParam)};
  var hasPending = ${hasPending ? "true" : "false"};
  var cssRatio = ${JSON.stringify(cssRatio)};
  var dataDir = ${JSON.stringify(path.join(ctx.dataDir, "generated"))};
  var POLL_MS = 2000;
  var ERROR_BACKOFF_MS = 3000;
  var timer = null;
  var mimeByExt = ${JSON.stringify(MIME)};

  function escHtml(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function enc(s){ return encodeURIComponent(String(s || '')); }
  function extOf(file){
    var match = String(file || '').match(/\\.([^.]+)$/);
    return match ? match[1].toLowerCase() : '';
  }
  function joinGeneratedPath(file){
    var sep = dataDir.indexOf('\\\\') >= 0 ? '\\\\' : '/';
    return dataDir.replace(/[\\\\/]+$/, '') + sep + file;
  }
  function payloadFor(file){
    var ext = extOf(file);
    var kind = /^(mp4|mov|webm)$/i.test(ext) ? 'video' : /^(mp3|wav|m4a|aac|flac|ogg)$/i.test(ext) ? 'audio' : 'image';
    return {
      fileName: file,
      name: file,
      path: joinGeneratedPath(file),
      kind: kind,
      ext: ext,
      mime: mimeByExt[ext] || (kind === 'video' ? 'video/mp4' : kind === 'audio' ? 'audio/mpeg' : 'image/png'),
      url: mediaBase + '/media/' + enc(file) + tokenParam,
      downloadUrl: mediaBase + '/media/download/' + enc(file) + tokenParam
    };
  }
  function renderMedia(payload) {
    var data = escHtml(JSON.stringify(payload));
    if (payload.kind === 'audio') {
      return '<div class="media-card" data-media="' + data + '">' +
        '<div class="preview audio-preview" style="aspect-ratio:' + escHtml(cssRatio) + '"><audio src="' + escHtml(payload.url) + '" controls preload="metadata"></audio></div>' +
        '<div class="actions">' +
        '<button class="action" type="button" data-action="open">Open</button>' +
        '<a class="action" href="' + escHtml(payload.downloadUrl) + '" download="' + escHtml(payload.name) + '">Save</a>' +
        '</div></div>';
    }
    var media = payload.kind === 'video'
      ? '<video src="' + escHtml(payload.url) + '" preload="metadata" muted playsinline></video>'
      : '<img src="' + escHtml(payload.url) + '" alt="generated image" loading="lazy">';
    return '<div class="media-card" data-media="' + data + '">' +
      '<button class="preview" type="button" data-action="open" style="aspect-ratio:' + escHtml(cssRatio) + '">' + media + '</button>' +
      '<div class="actions">' +
      '<button class="action" type="button" data-action="open">查看大图</button>' +
      '<a class="action" href="' + escHtml(payload.downloadUrl) + '" download="' + escHtml(payload.name) + '">保存</a>' +
      '</div></div>';
  }
  function buildInner(t) {
    if (t.status === 'done' && t.files && t.files.length) return renderMedia(payloadFor(t.files[0]));
    if (t.status === 'failed') return '<div class="failed">' + escHtml(t.failReason || '生成失败') + '</div>';
    return '<div class="skeleton" aria-label="生成中"></div>';
  }
  function findCell(taskId) {
    var safe = String(taskId).replace(/[^a-zA-Z0-9_-]/g, '');
    if (safe !== String(taskId)) return null;
    return document.querySelector('[data-task-id="' + safe + '"]');
  }
  async function poll() {
    timer = null;
    try {
      var res = await fetch(pollApi, { cache: 'no-store' });
      if (!res.ok) throw new Error('http ' + res.status);
      var data = await res.json();
      var tasks = (data && data.tasks) || [];
      var stillPending = false;
      for (var i = 0; i < tasks.length; i++) {
        var t = tasks[i];
        if (t.status === 'pending') stillPending = true;
        var cell = findCell(t.taskId);
        if (!cell) continue;
        if (cell.dataset.state === t.status) continue;
        cell.innerHTML = buildInner(t);
        cell.dataset.state = t.status;
      }
      notifyResize();
      if (stillPending) timer = setTimeout(poll, POLL_MS);
    } catch (e) {
      timer = setTimeout(poll, ERROR_BACKOFF_MS);
    }
  }
  function notifyResize() {
    parent.postMessage({
      type: 'resize-request',
      payload: { width: document.body.scrollWidth, height: document.body.scrollHeight }
    }, '*');
  }
  function openMedia(card) {
    if (!card) return;
    try {
      parent.postMessage({ type: 'media-open-request', payload: JSON.parse(card.dataset.media || '{}') }, '*');
    } catch {}
  }
  document.addEventListener('click', function(event) {
    var target = event.target;
    var opener = target && target.closest ? target.closest('[data-action="open"]') : null;
    if (!opener) return;
    event.preventDefault();
    openMedia(opener.closest('.media-card'));
  });
  function initialReady() {
    notifyResize();
    parent.postMessage({ type: 'ready' }, '*');
  }
  requestAnimationFrame(initialReady);
  new ResizeObserver(notifyResize).observe(document.body);
  if (hasPending) timer = setTimeout(poll, POLL_MS);
})();
</script>
</body></html>`;

    return c.html(html);
  });
}

function renderMedia(payload) {
  if (payload.kind === "audio") {
    return `<div class="media-card" data-media="${escAttr(JSON.stringify(payload))}">`
      + `<div class="preview audio-preview"><audio src="${escAttr(payload.url)}" controls preload="metadata"></audio></div>`
      + `<div class="actions">`
      + `<button class="action" type="button" data-action="open">Open</button>`
      + `<a class="action" href="${escAttr(payload.downloadUrl)}" download="${escAttr(payload.name)}">Save</a>`
      + `</div></div>`;
  }
  const media = payload.kind === "video"
    ? `<video src="${escAttr(payload.url)}" preload="metadata" muted playsinline></video>`
    : `<img src="${escAttr(payload.url)}" alt="generated image" loading="lazy">`;
  return `<div class="media-card" data-media="${escAttr(JSON.stringify(payload))}">`
    + `<button class="preview" type="button" data-action="open">${media}</button>`
    + `<div class="actions">`
    + `<button class="action" type="button" data-action="open">查看大图</button>`
    + `<a class="action" href="${escAttr(payload.downloadUrl)}" download="${escAttr(payload.name)}">保存</a>`
    + `</div></div>`;
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escAttr(s) {
  return esc(s)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
