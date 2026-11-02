# TeX Studio Minimal

一个按 apple-minimal 设计语言做的 LaTeX 编辑器，用来替代 TeXstudio。基于 Electron + CodeMirror 6 + pdf.js，调用本机 TeX Live（自动检测 `D:\texlive\2025\bin\windows`）。

## 安装与运行

- 下载：在 [Releases](https://github.com/Liyucheng1997/texstudio-minimal/releases) 下载 `TeX Studio Minimal Setup 1.1.0.exe`（安装时会关联 .tex / .bib / .cls / .sty）
- 需要本机已安装 TeX Live 或 MiKTeX；也可在 设置 → 编译 中手动指定 TeX 的 bin 目录
- 从源码运行：`npm install` 后 `npm start`；打包安装程序：`npm run dist`（输出到 `release/`）

## 主要功能

| 类别 | 功能 |
| --- | --- |
| 编译 | pdfLaTeX / XeLaTeX / LuaLaTeX / latexmk；智能模式自动运行 BibTeX/Biber、makeindex 并按需重跑；支持 `% !TEX program`、`% !TEX root`、TeXstudio 的 `% !TeX TXS-program:compile`，以及 latexmkrc 的 `$aux_dir` |
| 预览 | 内置 PDF 预览，重新编译不闪烁、保持位置；缩放、适合宽度/整页、PDF 内查找、深色反色 |
| SyncTeX | Ctrl+单击 PDF 跳到源码；Ctrl+单击源码（或 Ctrl+Alt+J）跳到 PDF；编译后自动定位到光标 |
| 编辑 | LaTeX 高亮、折叠（环境/章节）、多光标、查找替换、`\begin` 回车自动补 `\end`、`\item` 续行、拼写检查（跳过命令和公式） |
| 补全 | 命令（带占位符）、环境、`\ref` 标签、`\cite` 文献（显示作者年份）、文件路径、宏包、自定义命令 |
| 悬停 | 公式 KaTeX 预览（识别自定义宏）、图片预览、文献信息、标签上下文 |
| 项目 | 主文档自动识别、文件树、结构大纲（章节/图表/标签/待办）、项目内搜索、符号面板、参考文献面板 |
| 消息 | 错误/警告/坏盒分类，点击跳转，行号旁标记；原始日志与编译输出 |
| 向导 | 快速开始、表格、插图、矩阵；latexindent 格式化；texcount 字数统计 |

## AI 写作（Claude）

标题栏的 **AI** 按钮（Ctrl+L）打开写作面板。先在 设置 → AI 写作 中填入 Anthropic API Key（用系统加密存储，只在主进程中使用），也可以用环境变量 `ANTHROPIC_API_KEY`。

- **对话写作**：AI 会读取当前文件（含光标位置）、选中内容、章节结构、标签和参考文献，可选附上整个项目或编译错误；回复里的 LaTeX 代码块可一键插入或替换选区
- **快捷指令**：续写下一段、润色、中文→学术英文、写摘要、起草本节、语法检查、生成表格、解释公式
- **改写选中内容**（Ctrl+K 或右键 → AI）：润色、精简、扩写、翻译、修正语法或自定义指令，原文与结果并排对比后再替换
- **续写**（Ctrl+Shift+Enter）：在光标处生成下一段，预览后插入
- **修复编译错误**：消息面板中点「AI 修复」，给出逐处的修改对比，确认后自动应用
- 模型可选 Claude Opus 5.5（默认）、Sonnet 5.5、Haiku 5.5、Fable 5.1；可调思考强度；支持自定义 API 地址（代理或网关）
- AI 只会引用 .bib 中已有的文献，缺少来源时写 `\cite{TODO}`，不会编造数据

常用快捷键：F5 编译并预览、F7 查看 PDF、F8 BibTeX、Ctrl+S 保存、Ctrl+P 快速打开、Ctrl+Shift+P 命令面板、Ctrl+Shift+F 项目搜索、Ctrl+T / Ctrl+U 注释 / 取消注释、Ctrl+B / Ctrl+I 粗体 / 斜体、Ctrl+Shift+M 行内公式。完整列表见 设置 → 快捷键。

## 目录

- `app/main/` 主进程：编译流水线、日志解析、SyncTeX、文件系统
- `src/renderer/` 界面：编辑器、PDF 预览、侧栏面板、对话框
- `src/styles/` 设计变量（tokens.css）与界面样式
- `test/` 测试用文档
