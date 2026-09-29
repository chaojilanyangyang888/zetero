# Paper Format Translator

一个面向 Zotero 10.0 及以上版本的论文阅读插件：从当前选中的 PDF 读取全文索引，保留章节和段落顺序，以左右栏显示英文原文与中文翻译，并单独解释论文中的 baseline、ablation、统计检验和其他比较方法。

## 安装

1. 使用本目录的 `paper-assistant-0.1.2.xpi`（压缩包根目录直接包含 `manifest.json` 和 `bootstrap.js`）。
2. 在 Zotero 的 `工具 > 插件` 中点击齿轮，选择“从文件安装插件”。
3. 重启 Zotero，在 `工具 > 论文翻译与对比方法解释` 打开窗口。

## 配置

首次使用点击“设置”，填写本地 Codex 和 Google Cloud Translation 配置。Codex 默认指向 `http://127.0.0.1:8000/v1`，并在结构分析和最终审校两个阶段复用同一个 Key。若系统环境变量中存在 `CODEX_API_KEY`，插件会自动使用它；否则使用设置页保存的 Key。Google 翻译需要 Google Cloud Translation v2 API Key。

点击“读取模型”会从本地 Codex 的 `/models` 接口读取可用模型，之后可以在下拉框中选择；也可以填写自定义模型覆盖下拉框。点击“测试 Codex”可先验证连接和 Key，再开始处理论文。思考深度设为 `auto` 时，插件会根据文章长度选择 low、medium 或 high；模型设为 `auto` 时交给本地 Codex 网关路由。

PDF 需要先被 Zotero 建立全文索引。若读取失败，在 Zotero 条目上右键并选择“重新提取全文”，再点击“读取选中 PDF”。

## 设计约束

- 原文、译文和章节顺序由结构化 JSON 驱动，公式、数字、引用编号和方法名在提示词中要求保持不变。
- 对比解释包含“比较目的、怎么做、如何解读”三个字段，覆盖 baseline、ablation 和统计检验。
- API Key 仅保存于本机 Zotero 偏好设置，不写入论文或插件文件。

## 发布更新

运行 `./build.ps1` 会生成版本号对应的 XPI、`paper-assistant.xpi` 和带 SHA-256 校验值的 `updates.json`。把这些文件连同源码推送到 `chaojilanyangyang888/zetero` 的 `main` 分支后，Zotero 会通过 manifest 中的公开 `update_url` 检查更新。每次发布前先增加 `manifest.json` 中的 `version`，再运行脚本并推送；仅覆盖 XPI 而不增加版本号不会触发更新。
