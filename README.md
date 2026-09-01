# IssueFlow

IssueFlow 是一个使用 Vite、Node.js 和 SQLite 构建的多人 Issue 协作系统，提供管理员平台配置、用户管理以及对齐 GitHub Issues 核心体验的 Issue、评论、标签、里程碑、时间线和通知能力，并提供仅面向 macOS 的菜单栏浮窗客户端。

## 技术栈

- React + Vite + TypeScript
- Fastify + TypeScript
- Prisma + SQLite
- Tauri 2 + Rust（macOS 桌面浮窗）
- pnpm workspace

## 本地启动

要求 Node.js 20.19+（或 22.12+）和 pnpm 10+。

```bash
cp .env.example apps/api/.env
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Web：<http://localhost:5173>
- API：<http://localhost:3101/api>
- 健康检查：<http://localhost:3101/api/health>

首次启动会按 `apps/api/.env` 中的 `ADMIN_USERNAME`、`ADMIN_PASSWORD` 和 `ADMIN_DISPLAY_NAME` 幂等创建唯一管理员。生产使用前必须更换默认管理员密码。

登录会话默认保存 30 天。浏览器本地只缓存经过校验的用户展示信息，真正的认证凭据保存在 HttpOnly Cookie 中；刷新页面时仍会向 API 重新验证会话。可通过 `SESSION_TTL_DAYS` 调整会话期限。

API 位于反向代理之后时，应把 `TRUST_PROXY_HOPS` 配置为请求到达 API 前的可信代理跳数；内置 Docker Compose 只有一层 Nginx，已固定为 `1`。直接暴露 API 时保持默认 `0`，避免信任客户端伪造的 `X-Forwarded-For`。

系统支持使用邀请码注册普通账号。本地环境在 API 的 `.env` 中设置 `REGISTRATION_INVITE_CODE`，Docker 部署在 `.env.docker` 中设置 `ISSUEFLOW_REGISTRATION_INVITE_CODE`。留空时注册 API 禁用；注册成功后会直接建立登录会话。邀请码只在服务端环境中保存，不会写入数据库或返回前端。

Issue 列表支持按当前搜索、作者、负责人、标签和里程碑条件导出 `.xlsx`。导出时选择关闭时间范围：所有未关闭 Issue 无视时间始终导出，已关闭 Issue 仅在关闭时间落入所选区间时导出。生成的工作簿沿用 `【需求进度管理表】（八月份）.xlsx` 的双行 14 列结构。新建 Issue 时可一并选择附件，详情页也支持继续上传、图片预览、下载和按权限删除。附件不限文件类型，单个不超过 10 MiB，每个 Issue 最多 20 个；本地默认保存到 `apps/api/uploads`，可通过 `UPLOAD_DIR` 修改。

管理员可在“管理后台 → 平台概览”查看前端、后端各自的语义版本、构建标识和构建时间。Docker 重新构建对应镜像后构建标识会更新，可用于判断浏览器缓存或服务镜像是否仍是旧版本。

登录用户可在 `/settings/profile` 分别修改显示名称和密码；密码修改成功后全部会话及 API Token 会失效。管理员可以在用户管理中修改其他用户的用户名。用户还可在 `/settings/api-tokens` 创建个人 API Token，并通过 `Authorization: Bearer <token>` 直接调用后端；详细接口和示例参见 [API 使用说明](./API使用说明.md)。

## macOS 桌面浮窗

桌面端常驻菜单栏，聚合“指派给我”“我关注的”和“最近关闭”的 Issue，支持搜索、摘要查看、关注/静音、标记完成与 5 秒撤销。指派和提及默认立即发送系统通知；关注 Issue 仅在状态或负责人变化时提醒，普通评论提醒默认关闭。

首次使用时，桌面端会打开当前 IssueFlow 网页。用户必须在已登录的浏览器 Session 中确认设备配对；换取的桌面 Bearer Token 只保存在 macOS Keychain，可在网页的 API Token 页面随时撤销。生产桌面端只接受 HTTPS/WSS；明文 HTTP/WS 仅供本机开发地址使用。

开发桌面端还需要 Rust stable 和 Xcode Command Line Tools：

```bash
pnpm install
pnpm tauri dev
```

生成供本机安装的 macOS DMG：

```bash
pnpm tauri build --bundles dmg --config '{"bundle":{"macOS":{"signingIdentity":"-"}}}'
```

产物位于 `apps/desktop/src-tauri/target/release/bundle/dmg/`。上述命令使用 ad-hoc 签名，只适合本机验证或受控的团队内部测试；首次启动可能需要在 Finder 中右键应用并选择“打开”。正式团队分发应配置 Apple Developer ID、Hardened Runtime 和公证，不应把 ad-hoc 构建作为公开下载版本。

桌面端“服务地址”只填写 IssueFlow 网页根地址，例如 `https://issues.example.com`，不要追加 `/api`、查询参数或页面路径。点击授权后，客户端会请求 `/api/desktop/pairings` 并在默认浏览器中打开 `/desktop/authorize`。如果配对接口返回 `404 NOT_FOUND`，说明线上 API 仍是旧镜像，需要重新构建并部署当前 `api`、`web` 服务；Compose 的 API 启动脚本会自动执行 Prisma 迁移。

默认全局快捷键为 `⌥⌘I`。在“偏好设置 → 桌面应用设置”中点击“录制快捷键”，再直接按下新的组合键并保存；若组合键已被其他应用占用，原快捷键会继续生效并显示冲突提示。快捷键、开机启动、窗口置顶、贴边吸附和服务地址属于本机设置；通知偏好、免打扰时段与最近关闭窗口按用户同步。

浮窗可从概览、Issue 详情、设置页标题栏以及授权页顶部拖动。贴边吸附默认开启：窗口在距离当前屏幕工作区边缘约 18 个逻辑像素内释放时自动吸附，也可在设置中关闭或使用“立即贴边”按钮。

授权完成后客户端会自动建立 WSS 实时连接。离线提示中的“重试”会同时重启 WebSocket 并刷新 Overview 快照；若 REST 数据可读取但实时连接仍失败，请确认反向代理已转发 `Upgrade`、`Connection` 和 `Authorization` 请求头，并检查 API 日志中的 `/api/realtime` 握手状态。

实时同步使用 API 进程内的单实例 WebSocket Hub。当前支持团队内多个用户与每用户多设备连接，但不支持多个 API 实例之间的跨实例事件广播；横向扩容前必须引入 Redis/NATS 等消息总线。

## Docker 一键部署

要求 Docker Engine 与 Docker Compose。首次部署：

```bash
cp .env.docker.example .env.docker
```

编辑 `.env.docker`，至少修改管理员密码、账号注册邀请码和云效加密密钥，然后执行：

```bash
docker compose --env-file .env.docker up -d --build
```

访问 <http://localhost:18080>。Docker 默认使用非常用端口：宿主机和 Web 容器为 `18080`，API 容器内网端口为 `13101`。Compose 会自动构建前端、执行 Prisma 迁移并启动 API；SQLite、用户登录 Session、业务数据和上传图片均保存在 `issueflow-data` 命名卷中，普通容器重建不会丢失数据。

```bash
# 查看状态和日志
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs -f

# 停止服务但保留数据
docker compose --env-file .env.docker down
```

本地 HTTP 保持 `ISSUEFLOW_COOKIE_SECURE=false`。通过 HTTPS 域名部署时，需要同步修改 `ISSUEFLOW_WEB_ORIGIN`、`ISSUEFLOW_YUNXIAO_WEBHOOK_BASE_URL`，并设置 `ISSUEFLOW_COOKIE_SECURE=true`。若 HTTPS 由 Compose Nginx 前面的另一层代理终止，还要把 `ISSUEFLOW_TRUST_PROXY_HOPS` 从 `1` 改为 `2`；该值必须等于请求到达 API 前的可信代理跳数。

## 云效 Codeup 联动

管理员可以在“管理后台 → 云效联动”绑定 Codeup 仓库，接收 Push 与合并请求 Webhook，并把提交、合并请求关联到 Issue。提交信息、分支名、合并请求标题或描述中的 `#123` 会引用对应 Issue；合并后的合并请求使用 `fixes #123`、`closes #123` 或 `resolves #123` 可自动关闭 Issue。

“管理后台 → 提交操作”可自定义 `#关键字Issue编号` 指令，使 Push 提交修改 Issue 的开放/关闭状态、添加标签，或同时执行两者。系统默认提供 `#o4`（开启 4 号 Issue）和 `#c4`（关闭 4 号 Issue）。

配置云效个人访问令牌、AI API Key、S3 AccessKey 或 WebDAV 凭据前，需要在 `apps/api/.env` 设置共用的 32 字节加密密钥：

```bash
openssl rand -hex 32
```

将结果填写到 `YUNXIAO_ENCRYPTION_KEY`，并把 `YUNXIAO_WEBHOOK_BASE_URL` 设置为云效可访问的 IssueFlow 公网地址（生产环境应使用 HTTPS）。重启 API 后，再由管理员页面保存云效配置。Token 和 Secret 会加密存储，API 不返回明文。支持云效中心版与 Region 版；可由页面测试 OpenAPI 连接并自动创建 Webhook，也可以按页面展示的 URL 手工配置。

## AI 自动标签

管理员可以在“管理后台 → 平台设置”配置并启用 OpenAI Chat Completions 兼容的 AI URL、模型名称、API Key、请求超时（5–300 秒）和每次最多添加的标签数。新建 Issue 没有选择标签时，系统会将任务加入后台队列，把标题、移除图片后的正文和现有标签列表发送给 AI，并自动添加 AI 返回的有效标签；附件和图片不会发送，AI 请求不会阻塞 Issue 创建，失败也不会影响创建结果。

支持 JSON Schema 结构化输出的模型可手动开启对应选项，开启后会通过 `response_format.type=json_schema` 严格约束 `labelIds`；不支持的模型请保持关闭，此时请求不会携带 `response_format`。
如需关闭模型的深度思考，可在管理后台开启对应选项；开启后请求会携带 `enable_thinking=false`，默认关闭该选项且不发送此扩展参数。

AI API Key 与云效凭据复用 `YUNXIAO_ENCRYPTION_KEY` 加密；Docker 部署使用 `ISSUEFLOW_YUNXIAO_ENCRYPTION_KEY`。API Key 只会加密存储，管理接口不会返回明文。

## 附件存储

管理员可在“管理后台 → 附件存储”选择服务器本地、S3 兼容存储或 WebDAV，三个模式互斥，只影响保存配置后新上传的附件。旧附件仍从原存储读取，不会自动迁移；附件列表、下载地址和权限校验保持不变。

S3 模式需要 Endpoint、Bucket、对象前缀和 AccessKey，Region 可留空（默认使用 `us-east-1`）。支持 AWS S3、阿里云 OSS、MinIO 及其他标准 S3 API 服务。WebDAV 模式需要服务根地址、附件目录、用户名和密码。两类凭据与云效凭据、AI API Key 复用 `YUNXIAO_ENCRYPTION_KEY` 加密，管理接口不会返回明文；建议授予专用目录的最小读写权限。

## 全量数据备份

管理员可在“管理后台 → 数据备份”导出 JSON 格式的全量备份，内容包括全部业务表、账号与 API Token 哈希、加密配置和附件文件。备份包含敏感数据，应加密保存并限制访问。

覆盖导入前必须输入页面要求的确认文字。导入会直接删除并替换当前平台全部数据；恢复后的附件统一保存在服务器本地，之后的新附件继续使用备份中的当前存储模式。跨环境恢复时必须同时保留原部署的 `YUNXIAO_ENCRYPTION_KEY`，否则备份内的加密凭据无法解密。单个备份文件最大 1 GiB，建议在维护时段操作并先备份当前数据。

## 常用命令

```bash
pnpm dev
pnpm tauri dev
pnpm tauri build --bundles dmg --config '{"bundle":{"macOS":{"signingIdentity":"-"}}}'
pnpm build
pnpm typecheck
pnpm test
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

## 工程结构

```text
apps/
  api/       Fastify API、Prisma 数据模型和后端测试
  desktop/   Tauri 2 macOS 菜单栏浮窗、React UI 与 Rust 系统集成
  web/       Vite React 前端和组件测试
packages/
  shared/    前后端共享 Schema、类型和常量
design-system/
  issueflow/ 产品视觉与交互规范
```

详细范围与验收标准见 [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)、[PRODUCT_SPEC.md](./PRODUCT_SPEC.md)、[YUNXIAO_INTEGRATION_PLAN.md](./YUNXIAO_INTEGRATION_PLAN.md)、[FLOATING_WINDOW_IMPLEMENTATION_PLAN.md](./FLOATING_WINDOW_IMPLEMENTATION_PLAN.md) 和 [DOCKER_DEPLOYMENT_PLAN.md](./DOCKER_DEPLOYMENT_PLAN.md)。API 调用参见 [API 使用说明](./API使用说明.md)。
