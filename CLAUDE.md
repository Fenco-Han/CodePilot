# CLAUDE.md

## Project Overview

CodePilot — Claude Code 的桌面 GUI 客户端，基于 Electron + Next.js。

## 本地参考项目路径（上下文共享/存储）

为便于后续分析与实现对照，本机已拉取以下参考仓库：

- craft-agents-oss: `/Users/op7418/Documents/code/资料/craft-agents-oss`
- opencode: `/Users/op7418/Documents/code/资料/opencode`

## Release Checklist

**发版流程（CI 自动打包 + 发布）：**

1. `package.json` 中的 `"version"` 字段更新为新版本号
2. `package-lock.json` 中的对应版本（运行 `npm install` 会自动同步）
3. 提交代码并推送到 `main` 分支
4. 创建并推送 tag：`git tag v{版本号} && git push origin v{版本号}`
5. **推送 tag 后 CI 会自动触发**（`.github/workflows/build.yml`）：
   - 自动在 macOS / Windows / Linux 上构建
   - 自动收集所有平台产物（DMG、exe、AppImage、deb、rpm）
   - 自动创建 GitHub Release 并上传所有产物
6. 等待 CI 完成，在 GitHub Release 页面补充 New Features / Bug Fixes 描述
7. 可通过 `gh run list` 查看 CI 状态，`gh run rerun <id> --failed` 重试失败的任务

**重要：不要手动创建 GitHub Release**，否则会与 CI 自动创建的 Release 冲突。如果需要本地打包测试，使用 `npm run electron:pack:mac` 但不要手动上传到 Release。

## 发版纪律

**禁止自动发版**：不要在完成代码修改后自动执行 `git push` + `git tag` + `git push origin tag` 发版流程。必须等待用户明确指示"发版"、"发布"或类似确认后才能执行。代码提交（commit）可以正常进行，但推送和打 tag 必须由用户确认。

## Development Rules

**提交前必须详尽测试：**
- 每次提交代码前，必须在开发环境中充分测试所有改动的功能，确认无回归
- 涉及前端 UI 的改动需要实际启动应用验证（`npm run dev` 或 `npm run electron:dev`）
- 涉及构建/打包的改动需要完整执行一次打包流程验证产物可用
- 涉及多平台的改动需要考虑各平台的差异性

**新增功能前必须详尽调研：**
- 新增功能前必须充分调研相关技术方案、API 兼容性、社区最佳实践
- 涉及 Electron API 需确认目标版本支持情况
- 涉及第三方库需确认与现有依赖的兼容性
- 涉及 Claude Code SDK 需确认 SDK 实际支持的功能和调用方式
- 对不确定的技术点先做 POC 验证，不要直接在主代码中试错

**Commit 信息规范：**
- 每次 commit 必须在 message body 中写清楚每个改动的具体内容和原因
- 标题行使用 conventional commits 格式（feat/fix/refactor/chore 等）
- body 中按文件或功能分组，说明：改了什么、为什么改、影响范围
- 如果是修复 bug，说明根因是什么，不只是描述现象
- 如果涉及架构决策（如选择方案 A 而非方案 B），简要说明理由

## Release Notes 规范

标题：`CodePilot v{版本号}`

正文必须包含：
- **本版本更新内容**（New Features / Bug Fixes，按实际情况分区）
- **Downloads**（各平台安装包说明）
- **Installation**（各平台安装步骤）
- **Requirements**（系统要求、依赖说明）
- **Changelog**（自上一版本以来的 commit 列表）

## Architecture Docs

- [Agent Tooling & TodoWrite Bridge](docs/agent-tooling-todo-bridge.md) — SDK → SSE → DB 事件流、TodoWrite 字段映射、tool_result 三层去重策略
- [多 IM 远程会话桥接系统](docs/bridge-system.md) — Telegram 远程操控 Claude 会话，含目录结构、数据流、关键设计决策

## Build Notes

- macOS 构建产出 DMG（arm64 + x64），Windows 产出 NSIS 安装包或 zip
- `scripts/after-pack.js` 会在打包时显式重编译 better-sqlite3 为 Electron ABI，确保原生模块兼容
- 构建前清理 `rm -rf release/ .next/` 可避免旧产物污染
- 构建 Windows 包后需要 `npm rebuild better-sqlite3` 恢复本地开发环境
- macOS 交叉编译 Windows 需要 Wine（Apple Silicon 上可能不可用），可用 zip 替代 NSIS
