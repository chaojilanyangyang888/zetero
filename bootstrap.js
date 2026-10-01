/* global Zotero, Services */

const PREF_BRANCH = "extensions.paper-assistant.";
let menuItem;
let retryTimer;
let contextItem;
let toolbarButton;
let pluginRootURI;
let menuRegistrations = [];
let overlay;

function registerModernMenus() {
  if (!Zotero.MenuManager?.registerMenu) return;
  const menuData = {
    menuType: "menuitem",
    onShown: (event, context) => context.menuElem.setAttribute("label", "翻译与解释论文"),
    onCommand: () => openAssistant()
  };
  for (const target of ["main/library/item", "main/menubar/tools"]) {
    const id = Zotero.MenuManager.registerMenu({
      menuID: `paper-assistant-${target.replaceAll("/", "-")}`,
      pluginID: "paper-assistant@local",
      target,
      menus: [{ ...menuData }]
    });
    if (id) menuRegistrations.push(id);
  }
}

function pref(name, fallback = "") {
  try {
    return Services.prefs.getStringPref(PREF_BRANCH + name, fallback);
  } catch (e) {
    return fallback;
  }
}

function getSelectedItem() {
  const pane = Zotero.getActiveZoteroPane();
  return pane && pane.getSelectedItems && pane.getSelectedItems()[0];
}

async function getPaperText(item) {
  let target = item;
  if (target && target.isRegularItem && !target.isRegularItem()) {
    target = Zotero.Items.get(target.parentItemID);
  }
  if (!target) throw new Error("请先在 Zotero 中选择一篇论文或其 PDF 附件。");

  const attachmentID = target.isAttachment && target.isAttachment()
    ? target.id
    : (target.getBestAttachment ? (await target.getBestAttachment())?.id : null);
  if (!attachmentID) throw new Error("所选条目没有可读取的 PDF 附件。");

  const pages = await Zotero.Fulltext.getPages(attachmentID);
  if (!pages || !pages.length) throw new Error("PDF 尚未建立全文索引，请在 Zotero 中右键条目并选择“重新提取全文”。");
  const pageText = await Zotero.Fulltext.getTextForPages(attachmentID, pages);
  return pageText.map((text, index) => `\n[Page ${pages[index]}]\n${text}`).join("\n");
}

async function callChat(text, options, system, reasoningEffort = "medium") {
  const url = options.url.replace(/\/$/, "") + "/chat/completions";
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${options.apiKey}` },
    body: JSON.stringify({ model: options.model, temperature: 0.1, reasoning_effort: reasoningEffort, response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: text.slice(0, 120000) }] })
  });
  if (!response.ok) throw new Error(`模型接口返回 ${response.status}：${await response.text()}`);
  const body = await response.json();
  return JSON.parse(body.choices?.[0]?.message?.content || "{}");
}

async function listCodexModels(options) {
  const response = await fetch(options.codexURL.replace(/\/$/, "") + "/models", {
    headers: { "Authorization": `Bearer ${options.codexKey}` }
  });
  if (!response.ok) throw new Error(`读取模型列表失败 ${response.status}：${await response.text()}`);
  const body = await response.json();
  return (body.data || []).map((model) => model.id).filter(Boolean).sort();
}

async function googleTranslate(values, options) {
  if (!options.googleKey) throw new Error("请在设置中填写 Google Cloud Translation API Key。");
  const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(options.googleKey)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: values, source: "en", target: "zh-CN", format: "text" })
  });
  if (!response.ok) throw new Error(`Google 翻译接口返回 ${response.status}：${await response.text()}`);
  const body = await response.json();
  return (body.data?.translations || []).map((x) => x.translatedText);
}

async function runPipeline(text, options) {
  const structurePrompt = `Return ONLY valid JSON with this shape:
{"title":"...","abstract":"...","sections":[{"heading":"...","paragraphs":[{"original":"..."}]}],"comparisons":[{"name":"...","purpose":"...","how":"...","interpretation":"..."}],"notes":["..."]}
You are the local Codex analysis stage. Preserve section order, paragraph boundaries, equations, numbers, citation keys and method names. Do not translate. Identify every baseline, ablation, pairwise comparison, control group, metric comparison, and statistical test. Explain what is compared, how it is set up, and how results should be interpreted.`;
  const effort = options.reasoningEffort === "auto" ? (text.length > 60000 ? "high" : text.length > 25000 ? "medium" : "low") : options.reasoningEffort;
  const structure = await callChat(text, { url: options.codexURL, apiKey: options.codexKey, model: options.codexModel }, structurePrompt, effort);
  const paragraphs = [];
  for (const section of (structure.sections || [])) for (const p of (section.paragraphs || [])) paragraphs.push(p.original || "");
  if (structure.abstract) paragraphs.unshift(structure.abstract);
  const translated = await googleTranslate(paragraphs, options);
  let i = 0;
  if (structure.abstract) structure.abstract = translated[i++];
  for (const section of (structure.sections || [])) for (const p of (section.paragraphs || [])) p.translation = translated[i++];
  const reviewPrompt = `You are the final local Codex academic editor. Return the same JSON object, preserving all keys and paragraph order. Check every Chinese translation against its English original. Correct mistranslations, omitted qualifiers, negation, numbers, units, equations, citation keys and method names. Keep technical terms consistent. Do not rewrite the English. Add short notes only for genuinely ambiguous source wording.`;
  const reviewed = await callChat(JSON.stringify(structure), { url: options.codexURL, apiKey: options.codexKey, model: options.codexModel }, reviewPrompt, effort);
  return reviewed;
}

function openAssistant() {
  Zotero.debug("Paper Format Translator: command received");
  const item = getSelectedItem();
  if (!item) {
    Zotero.debug("Paper Format Translator: no selected item");
    Services.prompt.alert(null, "Paper Format Translator", "请先选择一篇论文或 PDF 附件。");
    return;
  }
  const options = {
    codexURL: pref("codexURL", "http://127.0.0.1:8000/v1"), codexKey: pref("codexKey", Services.env?.get?.("CODEX_API_KEY") || ""), codexModel: pref("codexModel", "auto"),
    reasoningEffort: pref("reasoningEffort", "auto"), googleKey: pref("googleKey")
  };
  const api = {
    getText: () => getPaperText(item),
    analyze: (text) => runPipeline(text, options),
    listModels: () => listCodexModels(options),
    testCodex: () => listCodexModels(options),
    savePreferences: (next) => {
      for (const key of ["codexURL", "codexKey", "codexModel", "reasoningEffort", "googleKey"])
        Services.prefs.setStringPref(PREF_BRANCH + key, next[key] || "");
    },
    defaults: options
  };
  try {
    const parent = Zotero.getMainWindow();
    if (overlay) overlay.remove();
    overlay = parent.document.createElement("div");
    overlay.id = "paper-assistant-overlay";
    Object.assign(overlay.style, { position: "fixed", inset: "24px", zIndex: "2147483647", background: "white", border: "1px solid #78909c", boxShadow: "0 8px 30px rgba(0,0,0,.35)" });
    const close = parent.document.createElement("button");
    close.textContent = "关闭";
    Object.assign(close.style, { position: "absolute", right: "8px", top: "8px", zIndex: "2", padding: "6px 12px", cursor: "pointer" });
    close.onclick = () => { overlay.remove(); overlay = null; };
    const frame = parent.document.createElement("iframe");
    Object.assign(frame.style, { width: "100%", height: "100%", border: "0" });
    frame.onload = () => {
      Zotero.debug("Paper Format Translator: assistant page loaded");
      try { frame.contentWindow.wrappedJSObject.paperAssistantAPI = api; } catch (e) { Zotero.debug("Paper Format Translator: API injection error " + e); }
    };
    frame.onerror = () => Zotero.debug("Paper Format Translator: assistant page load error");
    frame.src = pluginRootURI + "content/assistant.html";
    overlay.append(close, frame);
    parent.document.documentElement.appendChild(overlay);
    Zotero.debug("Paper Format Translator: assistant overlay shown");
  } catch (error) {
    Zotero.debug("Paper Format Translator: overlay error " + error);
    Services.prompt.alert(null, "Paper Format Translator", "无法打开翻译窗口：" + error);
  }
}

function install() {}
function addToWindow(win) {
  if (!win) return;
  Zotero.debug("Paper Format Translator: adding Zotero 10 entry points");
  const toolsMenu = win.document.querySelector("#menu_ToolsPopup");
  if (toolsMenu && !menuItem) {
    menuItem = win.document.createXULElement("menuitem");
    menuItem.id = "paper-assistant-menuitem";
    menuItem.setAttribute("label", "论文翻译与对比方法解释");
    menuItem.addEventListener("command", openAssistant);
    toolsMenu.appendChild(menuItem);
  }
  const itemMenu = win.document.querySelector("#zotero-itemmenu, #zotero-itemmenu-popup, #zotero-items-menu");
  if (itemMenu && !contextItem) {
    contextItem = win.document.createXULElement("menuitem");
    contextItem.id = "paper-assistant-context-item";
    contextItem.setAttribute("label", "翻译与解释论文");
    contextItem.addEventListener("command", openAssistant);
    itemMenu.appendChild(contextItem);
  }
  const toolbar = win.document.querySelector("#zotero-toolbar, #zotero-items-toolbar, #zotero-items-toolbar-container, toolbar[is='customizable-toolbar']");
  if (toolbar && !toolbarButton) {
    toolbarButton = win.document.createXULElement("toolbarbutton");
    toolbarButton.id = "paper-assistant-toolbar-button";
    toolbarButton.className = "toolbarbutton-1";
    toolbarButton.setAttribute("label", "论文翻译");
    toolbarButton.setAttribute("tooltiptext", "翻译论文并解释对比方法");
    toolbarButton.addEventListener("command", openAssistant);
    toolbar.appendChild(toolbarButton);
  }
  if ((!toolsMenu || !itemMenu || !toolbar) && !retryTimer) retryTimer = win.setTimeout(() => { retryTimer = null; addToWindow(win); }, 1000);
}
function startup({ rootURI }) {
  pluginRootURI = rootURI;
  Zotero.debug("Paper Format Translator: startup " + rootURI);
  registerModernMenus();
  const windows = typeof Zotero.getMainWindows === "function" ? Zotero.getMainWindows() : [Zotero.getMainWindow()];
  for (const win of windows) addToWindow(win);
}
function onMainWindowLoad({ window }) {
  Zotero.debug("Paper Format Translator: main window loaded");
  addToWindow(window);
}
function onMainWindowUnload({ window }) {
  if (overlay && overlay.ownerDocument === window.document) { overlay.remove(); overlay = null; }
  if (menuItem) { menuItem.remove(); menuItem = null; }
  if (contextItem) { contextItem.remove(); contextItem = null; }
  if (toolbarButton) { toolbarButton.remove(); toolbarButton = null; }
}
function shutdown() {
  if (retryTimer) clearTimeout(retryTimer);
  if (menuItem) { menuItem.remove(); menuItem = null; }
  if (contextItem) { contextItem.remove(); contextItem = null; }
  if (toolbarButton) { toolbarButton.remove(); toolbarButton = null; }
  if (overlay) { overlay.remove(); overlay = null; }
  if (Zotero.MenuManager?.unregisterMenu) {
    for (const id of menuRegistrations) Zotero.MenuManager.unregisterMenu(id);
  }
  menuRegistrations = [];
  pluginRootURI = null;
}
function uninstall() {}
