export default function (app, ctx) {
  app.get("/card", (c) => {
    const batchId = c.req.query("batch");
    if (!batchId) return c.text("Missing batch parameter", 400);

    const tasks = ctx._openMontage?.store?.getByBatch(batchId) || [];
    const token = c.req.query("token") || "";
    const pluginId = ctx.pluginId;
    const mediaBase = `/api/plugins/${pluginId}`;
    const tokenParam = token ? `?token=${token}` : "";
    const hanaCss = c.req.query("hana-css") || "";
    const hasPending = tasks.some((task) => task.status === "pending");

    function renderTask(task) {
      if (task.status === "done" && task.files?.length) {
        const primary = task.files.find((file) => /\.(mp4|mov|webm|mkv)$/i.test(file)) || task.files[0];
        const extras = task.files.filter((file) => file !== primary);
        const mediaUrl = `${mediaBase}/media/${esc(primary)}${tokenParam}`;
        const isVideo = /\.(mp4|mov|webm|mkv)$/i.test(primary);
        const mediaHtml = isVideo
          ? `<video src="${mediaUrl}" controls preload="metadata" playsinline></video>`
          : `<img src="${mediaUrl}" alt="${esc(task.prompt || "OpenMontage preview")}">`;
        const extraList = extras.length
          ? `<ul class="extras">${extras.map((file) => `<li><a href="${mediaBase}/media/${esc(file)}${tokenParam}" target="_blank" rel="noreferrer">${esc(file)}</a></li>`).join("")}</ul>`
          : "";
        return `
          <div class="task-title">${esc(task.prompt)}</div>
          ${mediaHtml}
          ${extraList}
        `;
      }
      if (task.status === "failed") {
        return `<div class="failed">${esc(task.failReason || "OpenMontage task failed")}</div>`;
      }
      return `
        <div class="task-title">${esc(task.prompt)}</div>
        <div class="pending">OpenMontage is rendering your video. Please wait.</div>
      `;
    }

    const body = tasks.length
      ? tasks.map((task) => `<section class="task" data-task-id="${esc(task.taskId)}" data-state="${esc(task.status)}">${renderTask(task)}</section>`).join("")
      : `<div class="failed">Task not found.</div>`;

    const pollApi = `${mediaBase}/tasks/batch/${encodeURIComponent(batchId)}${tokenParam}`;
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
${hanaCss ? `<link rel="stylesheet" href="${hanaCss}">` : ""}
<style>
*{box-sizing:border-box}body{margin:0;padding:8px;background:var(--bg-card,#FCFAF5);font:13px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text,#1f2937)}
.task{display:flex;flex-direction:column;gap:8px}
.task-title{font-weight:600;font-size:13px}
video,img{display:block;max-width:100%;border-radius:10px;background:#000}
.pending{padding:12px;border-radius:10px;background:#f1f5f9;color:#475569}
.failed{padding:12px;border-radius:10px;background:#fef2f2;color:#b91c1c}
.extras{margin:0;padding-left:18px}
.extras a{color:inherit}
</style></head>
<body>${body}
<script>
(function(){
  var pollApi = ${JSON.stringify(pollApi)};
  var hasPending = ${hasPending ? "true" : "false"};
  var timer = null;
  function escHtml(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function renderTask(task) {
    if (task.status === 'done' && task.files && task.files.length) {
      var primary = task.files.find(function(file){ return /\\.(mp4|mov|webm|mkv)$/i.test(file); }) || task.files[0];
      var extras = task.files.filter(function(file){ return file !== primary; });
      var mediaUrl = ${JSON.stringify(mediaBase)} + '/media/' + escHtml(primary) + ${JSON.stringify(tokenParam)};
      var isVideo = /\.(mp4|mov|webm|mkv)$/i.test(primary);
      var mediaHtml = isVideo
        ? '<video src="' + mediaUrl + '" controls preload="metadata" playsinline></video>'
        : '<img src="' + mediaUrl + '" alt="' + escHtml(task.prompt || 'OpenMontage preview') + '">';
      var extraList = extras.length ? '<ul class="extras">' + extras.map(function(file){
        return '<li><a href="' + ${JSON.stringify(mediaBase)} + '/media/' + escHtml(file) + ${JSON.stringify(tokenParam)} + '" target="_blank" rel="noreferrer">' + escHtml(file) + '</a></li>';
      }).join('') + '</ul>' : '';
      return '<div class="task-title">' + escHtml(task.prompt) + '</div>' + mediaHtml + extraList;
    }
    if (task.status === 'failed') {
      return '<div class="failed">' + escHtml(task.failReason || 'OpenMontage task failed') + '</div>';
    }
    return '<div class="task-title">' + escHtml(task.prompt) + '</div><div class="pending">OpenMontage is rendering your video. Please wait.</div>';
  }
  async function poll(){
    timer = null;
    try{
      var res = await fetch(pollApi, { cache: 'no-store' });
      if (!res.ok) throw new Error('http ' + res.status);
      var data = await res.json();
      var tasks = (data && data.tasks) || [];
      var stillPending = false;
      tasks.forEach(function(task){
        if (task.status === 'pending') stillPending = true;
        var node = document.querySelector('[data-task-id="' + task.taskId.replace(/[^a-zA-Z0-9_-]/g, '') + '"]');
        if (!node) return;
        if (node.dataset.state === task.status) return;
        node.innerHTML = renderTask(task);
        node.dataset.state = task.status;
      });
      if (stillPending) timer = setTimeout(poll, 2000);
      notifyResize();
    }catch(e){
      timer = setTimeout(poll, 3000);
    }
  }
  function notifyResize() {
    parent.postMessage({ type: 'resize-request', payload: { width: document.body.scrollWidth, height: document.body.scrollHeight } }, '*');
  }
  new ResizeObserver(notifyResize).observe(document.body);
  requestAnimationFrame(function(){ notifyResize(); parent.postMessage({ type: 'ready' }, '*'); });
  if (hasPending) timer = setTimeout(poll, 2000);
})();
</script></body></html>`;

    return c.html(html);
  });
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
