# 多 IM 远程会话桥接系统

## 核心思路

让用户通过 Telegram（后续可扩展 Discord/飞书等）远程操控 CodePilot 中的 Claude 会话。复用现有 `streamClaude()` 管线，在服务端消费 SSE 流，而非通过浏览器。

## 目录结构

```
src/lib/bridge/
├── types.ts                 # 共享类型（ChannelBinding, BridgeStatus, InboundMessage 等）
├── channel-adapter.ts       # 抽象基类 + adapter 注册表（registerAdapterFactory/createAdapter）
├── channel-router.ts        # (channel, user, thread) → session 映射，自动创建/绑定会话
├── conversation-engine.ts   # 服务端消费 streamClaude() SSE 流，保存消息到 DB
├── permission-broker.ts     # 权限请求转发到 IM 内联按钮，处理回调审批
├── delivery-layer.ts        # 出站消息分片、限流、重试退避、HTML 降级
├── bridge-manager.ts        # 生命周期编排，adapter 事件循环，/stop abort，命令路由
├── adapters/
│   ├── index.ts             # Adapter 目录文件（side-effect import 自注册所有 adapter）
│   ├── telegram-adapter.ts  # Telegram 长轮询 + offset 安全水位 + 自注册
│   └── telegram-utils.ts    # callTelegramApi / escapeHtml / splitMessage
└── security/
    ├── rate-limiter.ts      # 按 chat 滑动窗口限流（20 条/分钟）
    └── validators.ts        # 路径/SessionID/危险输入校验
```

## 数据流

```
Telegram 消息 → TelegramAdapter.pollLoop() → enqueue()
  → BridgeManager.runAdapterLoop() → handleMessage()
    → 命令? → handleCommand() 处理 /new /bind /cwd /mode /stop 等
    → 普通消息? → ChannelRouter.resolve() 获取 ChannelBinding
      → ConversationEngine.processMessage()
        → streamClaude() 获取 SSE 流
        → consumeStream() 服务端消费
          → permission_request → 立即回调 → PermissionBroker 转发到 IM
          → text/tool_use/tool_result → 累积内容块
          → result → 捕获 tokenUsage + sdkSessionId
        → addMessage() 保存到 DB
      → DeliveryLayer.deliver() → 分片 + 限流 + 发送到 Telegram
    → finally: adapter.acknowledgeUpdate(updateId) → 推进 committedOffset 并持久化
```

## DB 表（在 db.ts migrateDb 中）

| 表 | 用途 |
|---|------|
| channel_bindings | IM 地址 → CodePilot session 映射 |
| channel_offsets | 轮询 offset 持久化（key 为 bot user ID，通过 getMe API 获取） |
| channel_dedupe | 出站消息幂等去重 |
| channel_outbound_refs | 平台消息 ID 映射 |
| channel_audit_logs | 审计日志 |
| channel_permission_links | 权限请求 → IM 消息映射（含 resolved 标记） |

## 关键设计决策

**1. 权限请求死锁解决**
SSE 流在 `permission_request` 事件处会阻塞等待审批。`consumeStream()` 通过 `onPermissionRequest` 回调在流消费过程中立即转发到 IM，而非等流结束后再转发。

**2. Offset 安全水位**
分离 `fetchOffset`（用于 getUpdates API）和 `committedOffset`（持久化到 DB）。消息入队时仅推进 fetchOffset，只有在 bridge-manager 完整处理完消息后（handleMessage 的 finally 块），才调用 `adapter.acknowledgeUpdate(updateId)` 推进 committedOffset 并持久化到 DB。这确保崩溃时未处理完的消息会被重新投递。内存 dedup set 防止重启后重复处理。

**2a. Bot 身份标识**
Offset 的 DB key 使用 Telegram `getMe` API 返回的 bot user ID（如 `telegram:bot123456`），而非 token hash。好处是 token 轮换后 offset 不丢失。首次迁移时自动将旧 token-hash key 的值复制到新 bot-ID key。

**3. 并发模型**
`processWithSessionLock()` 实现同会话串行、跨会话并行。不同用户的消息不互相阻塞。

**4. Adapter 注册式架构**
新 IM 只需实现 `BaseChannelAdapter` 并调用 `registerAdapterFactory()` 自注册，然后在 `adapters/index.ts` 中添加一行 side-effect import。bridge-manager 通过 `import './adapters'` 加载目录，registry 自动发现所有已注册的 adapter，无硬编码依赖。

**5. 权限回调安全**
PermissionBroker 在处理 IM 内联按钮回调时，验证 callbackData 中的 chatId 和 messageId 与存储的 permission_link 记录匹配，防止跨聊天伪造审批。`markPermissionLinkResolved()` 使用 `AND resolved = 0` 原子条件更新，确保同一权限请求不被重复审批。

**6. 输入校验**
`security/validators.ts` 对所有 IM 入站命令参数做校验：工作目录路径（拒绝 `..`、null 字节、shell 元字符）、session ID（hex/UUID 格式）、危险输入检测（命令注入、管道符）。`sanitizeInput()` 剥离控制字符并限制 32K 长度。

**7. runAdapterLoop 必须在 state.running = true 之后启动**
`runAdapterLoop` 内部是 fire-and-forget 的 async IIFE，循环条件 `while (state.running && ...)` 在第一个 `await` 之前同步求值。如果调用时 `state.running` 还是 `false`，循环直接跳过，消费者永远不会启动，消息入队后无人消费。`start()` 中必须先设 `state.running = true`，再调用 `runAdapterLoop`。

**8. 出站限流**
`security/rate-limiter.ts` 按 chatId 滑动窗口限流（默认 20 条/分钟）。`DeliveryLayer` 在每次发送前调用 `rateLimiter.acquire(chatId)` 阻塞等待配额，分片间额外加 300ms 节流。错误分类：429 尊重 `retry_after`、5xx 指数退避、4xx 不重试、解析错误降级纯文本。

## 设置项（settings 表）

| Key | 说明 |
|-----|------|
| remote_bridge_enabled | 总开关 |
| bridge_telegram_enabled | Telegram 通道开关 |
| bridge_auto_start | 服务启动时自动拉起桥接 |
| bridge_default_work_dir | 新建会话默认工作目录 |
| bridge_default_model | 新建会话默认模型 |
| bridge_default_provider_id | 新建会话默认服务商 |
| telegram_bridge_allowed_users | 白名单用户 ID（逗号分隔） |

## API 路由

| 路由 | 方法 | 功能 |
|------|------|------|
| /api/bridge | GET | 返回 BridgeStatus（纯查询，无副作用） |
| /api/bridge | POST | `{ action: 'start' \| 'stop' \| 'auto-start' }` |
| /api/bridge/channels | GET | 列出活跃通道（支持 `?active=true/false` 过滤） |
| /api/bridge/settings | GET/PUT | 读写 bridge 设置 |

## Telegram 命令

| 命令 | 功能 |
|------|------|
| /new [path] | 新建会话 |
| /bind \<session_id\> | 绑定已有会话 |
| /cwd /path | 切换工作目录 |
| /mode plan\|code\|ask | 切换模式 |
| /status | 当前状态 |
| /sessions | 列出会话 |
| /stop | 中止运行中任务 |
| /help | 帮助 |

## 相关文件（bridge 之外）

- `src/lib/telegram-bot.ts` — 通知模式（UI 发起会话的通知），与 bridge 模式互斥
- `src/lib/permission-registry.ts` — 权限 Promise 注册表，bridge 和 UI 共用
- `src/lib/claude-client.ts` — streamClaude()，bridge 和 UI 共用
- `src/components/bridge/BridgeSection.tsx` — Bridge 设置 UI（一级导航 /bridge）
- `src/components/bridge/TelegramBridgeSection.tsx` — Telegram 凭据 + 白名单设置 UI（/bridge#telegram）
- `electron/main.ts` — 窗口关闭时 bridge 活跃则保持后台运行；启动时通过 POST `auto-start` 触发桥接恢复
- `src/app/api/settings/telegram/verify/route.ts` — 支持 `register_commands` action 注册 Telegram 命令菜单
