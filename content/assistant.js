const api = window.arguments?.[0];
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

function render(data) {
  let html = `<h1 class="paper-title">${esc(data.title || "Untitled paper")}</h1>`;
  if (data.abstract) html += `<div class="abstract"><span class="label">Abstract / 摘要</span>${esc(data.abstract)}</div>`;
  for (const section of (data.sections || [])) {
    html += `<section class="section"><h3>${esc(section.heading || "Section")}</h3>`;
    for (const p of (section.paragraphs || [])) html += `<div class="para"><div class="original"><span class="label">Original</span>${esc(p.original)}</div><div class="translation"><span class="label">中文翻译</span>${esc(p.translation)}</div></div>`;
    html += `</section>`;
  }
  if (data.comparisons?.length) {
    html += `<section class="section"><h3>Comparison methods / 对比方法</h3>`;
    for (const c of data.comparisons) html += `<div class="comparison"><h4>${esc(c.name)}</h4><p><b>比较目的：</b>${esc(c.purpose)}</p><p><b>怎么做：</b>${esc(c.how)}</p><p><b>如何解读：</b>${esc(c.interpretation)}</p></div>`;
    html += `</section>`;
  }
  if (data.notes?.length) html += `<section class="section"><h3>Notes / 注释</h3><ul>${data.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></section>`;
  $("result").innerHTML = html;
}

for (const id of ["codexURL", "codexKey", "reasoningEffort", "googleKey"]) $(id).value = api?.defaults?.[id] || "";
let savedModel = api?.defaults?.codexModel || "auto";
function setModels(models) {
  const select = $("codexModel");
  select.innerHTML = "";
  for (const model of ["auto", ...models]) { const option = document.createElement("option"); option.value = model; option.textContent = model === "auto" ? "auto（自动路由）" : model; select.appendChild(option); }
  if ([...select.options].some((option) => option.value === savedModel)) { select.value = savedModel; $("codexModelCustom").value = ""; }
  else $("codexModelCustom").value = savedModel;
}
setModels([]);
$("codexModelCustom").value = savedModel !== "auto" ? savedModel : "";
$("settingsBtn").onclick = () => $("settings").classList.toggle("hidden");
$("saveSettings").onclick = () => { const next = {}; for (const id of ["codexURL", "codexKey", "reasoningEffort", "googleKey"]) next[id] = $(id).value.trim(); next.codexModel = $("codexModelCustom").value.trim() || $("codexModel").value; api.savePreferences(next); $("status").textContent = "设置已保存"; };
$("modelsBtn").onclick = async () => { try { $("status").textContent = "正在读取 Codex 模型…"; const models = await api.listModels(); setModels(models); $("status").textContent = `已读取 ${models.length} 个模型`; } catch (e) { $("status").textContent = e.message; } };
$("testBtn").onclick = async () => { try { $("status").textContent = "正在测试 Codex 连接…"; await api.testCodex(); $("status").textContent = "Codex 连接正常"; } catch (e) { $("status").textContent = e.message; } };
$("loadBtn").onclick = async () => { try { $("status").textContent = "正在读取全文索引…"; $("source").value = await api.getText(); $("status").textContent = "已读取，可编辑后继续"; } catch (e) { $("status").textContent = e.message; } };
$("analyzeBtn").onclick = async () => { const text = $("source").value.trim(); if (!text) return $("status").textContent = "请先读取 PDF 或粘贴英文内容"; try { $("analyzeBtn").disabled = true; $("status").textContent = "Codex 正在识别结构和 baseline，随后将复核译文…"; render(await api.analyze(text)); $("status").textContent = "完成：Google 初译并已由 Codex 复核"; } catch (e) { $("status").textContent = e.message; } finally { $("analyzeBtn").disabled = false; } };
