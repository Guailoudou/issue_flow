# IssueFlow

IssueFlow 是一个使用 Vite、Node.js 和 SQLite 构建的多人 Issue 协作系统，提供管理员平台配置、用户管理以及对齐 GitHub Issues 核心体验的 Issue、评论、标签、里程碑、时间线和通知能力。

## 技术栈

- React + Vite + TypeScript
- Fastify + TypeScript
- Prisma + SQLite
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

系统支持使用邀请码注册普通账号。本地环境在 API 的 `.env` 中设置 `REGISTRATION_INVITE_CODE`，Docker 部署在 `.env.docker` 中设置 `ISSUEFLOW_REGISTRATION_INVITE_CODE`。留空时注册 API 禁用；注册成功后会直接建立登录会话。邀请码只在服务端环境中保存，不会写入数据库或返回前端。

Issue 列表支持按当前搜索、作者、负责人、标签和里程碑条件导出 `.xlsx`。导出时选择关闭时间范围：所有未关闭 Issue 无视时间始终导出，已关闭 Issue 仅在关闭时间落入所选区间时导出。生成的工作簿沿用 `【需求进度管理表】（八月份）.xlsx` 的双行 14 列结构。新建 Issue 时可一并选择附件，详情页也支持继续上传、图片预览、下载和按权限删除。附件不限文件类型，单个不超过 10 MiB，每个 Issue 最多 20 个；本地默认保存到 `apps/api/uploads`，可通过 `UPLOAD_DIR` 修改。

管理员可在“管理后台 → 平台概览”查看前端、后端各自的语义版本、构建标识和构建时间。Docker 重新构建对应镜像后构建标识会更新，可用于判断浏览器缓存或服务镜像是否仍是旧版本。

登录用户可在 `/settings/profile` 分别修改显示名称和密码；密码修改成功后全部会话及 API Token 会失效。管理员可以在用户管理中修改其他用户的用户名。用户还可在 `/settings/api-tokens` 创建个人 API Token，并通过 `Authorization: Bearer <token>` 直接调用后端；详细接口和示例参见 [API 使用说明](./API使用说明.md)。

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

本地 HTTP 保持 `ISSUEFLOW_COOKIE_SECURE=false`。通过 HTTPS 域名部署时，需要同步修改 `ISSUEFLOW_WEB_ORIGIN`、`ISSUEFLOW_YUNXIAO_WEBHOOK_BASE_URL`，并设置 `ISSUEFLOW_COOKIE_SECURE=true`。

## 云效 Codeup 联动

管理员可以在“管理后台 → 云效联动”绑定 Codeup 仓库，接收 Push 与合并请求 Webhook，并把提交、合并请求关联到 Issue。提交信息、分支名、合并请求标题或描述中的 `#123` 会引用对应 Issue；合并后的合并请求使用 `fixes #123`、`closes #123` 或 `resolves #123` 可自动关闭 Issue。

配置云效个人访问令牌或 Webhook Secret 前，需要在 `apps/api/.env` 设置独立的 32 字节加密密钥：

```bash
openssl rand -hex 32
```

将结果填写到 `YUNXIAO_ENCRYPTION_KEY`，并把 `YUNXIAO_WEBHOOK_BASE_URL` 设置为云效可访问的 IssueFlow 公网地址（生产环境应使用 HTTPS）。重启 API 后，再由管理员页面保存云效配置。Token 和 Secret 会加密存储，API 不返回明文。支持云效中心版与 Region 版；可由页面测试 OpenAPI 连接并自动创建 Webhook，也可以按页面展示的 URL 手工配置。

## AI 自动标签

管理员可以在“管理后台 → 平台设置”配置并启用 OpenAI Chat Completions 兼容的 AI URL、模型名称、API Key 和每次最多添加的标签数。新建 Issue 没有选择标签时，系统会把标题、移除图片后的正文和现有标签列表发送给 AI，并自动添加 AI 返回的有效标签；附件和图片不会发送，AI 请求失败也不会影响 Issue 创建。

AI API Key 与云效凭据复用 `YUNXIAO_ENCRYPTION_KEY` 加密；Docker 部署使用 `ISSUEFLOW_YUNXIAO_ENCRYPTION_KEY`。API Key 只会加密存储，管理接口不会返回明文。

## 常用命令

```bash
pnpm dev
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
  web/       Vite React 前端和组件测试
packages/
  shared/    前后端共享 Schema、类型和常量
design-system/
  issueflow/ 产品视觉与交互规范
```

详细范围与验收标准见 [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)、[PRODUCT_SPEC.md](./PRODUCT_SPEC.md)、[YUNXIAO_INTEGRATION_PLAN.md](./YUNXIAO_INTEGRATION_PLAN.md) 和 [DOCKER_DEPLOYMENT_PLAN.md](./DOCKER_DEPLOYMENT_PLAN.md)。API 调用参见 [API 使用说明](./API使用说明.md)。
