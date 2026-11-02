# TeX Studio Minimal

一个按 apple-minimal 设计语言做的 LaTeX 编辑器，用来替代 TeXstudio。基于 Electron + CodeMirror 6 + pdf.js，调用本机 TeX Live（自动检测 `D:\texlive\2025\bin\windows`）。

## 安装与运行

- 下载：在 [Releases](https://github.com/Liyucheng1997/texstudio-minimal/releases) 下载 `TeX Studio Minimal Setup 1.0.0.exe`（安装时会关联 .tex / .bib / .cls / .sty）
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

常用快捷键：F5 编译并预览、F7 查看 PDF、F8 BibTeX、Ctrl+S 保存、Ctrl+P 快速打开、Ctrl+Shift+P 命令面板、Ctrl+Shift+F 项目搜索、Ctrl+T / Ctrl+U 注释 / 取消注释、Ctrl+B / Ctrl+I 粗体 / 斜体、Ctrl+Shift+M 行内公式。完整列表见 设置 → 快捷键。

## 目录

- `app/main/` 主进程：编译流水线、日志解析、SyncTeX、文件系统
- `src/renderer/` 界面：编辑器、PDF 预览、侧栏面板、对话框
- `src/styles/` 设计变量（tokens.css）与界面样式
- `test/` 测试用文档
