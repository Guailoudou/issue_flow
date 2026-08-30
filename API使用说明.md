# IssueFlow API 使用说明

本文以线上地址 `https://issue.gldhn.top` 为例。所有业务 API 的基础地址为：

```text
https://issue.gldhn.top/api
```

## 1. 创建和管理 API Token

登录 IssueFlow 后进入 `/settings/api-tokens`，填写名称并选择 30 天、90 天、365 天或永不过期，即可创建 Token。

- Token 以 `ift_` 开头，完整值只在创建成功时显示一次。
- 服务端只保存 Token 的 SHA-256 摘要，无法找回原始值；遗失后请撤销并重新创建。
- 每个账户最多保留 20 个有效 Token。
- Token 实时继承所属账户的身份、角色和业务权限。普通用户的 Token 无法调用管理员接口。
- 用户被停用、删除或重置密码时，该用户的全部 Token 会立即失效。
- 退出网页登录只会注销浏览器会话，不会撤销 API Token。

也可以通过已有的登录会话或 API Token 管理 Token：

### 查询 Token

```http
GET /api/auth/api-tokens
```

响应不会包含完整 Token 或服务端摘要：

```json
{
  "tokens": [
    {
      "id": 12,
      "name": "CI 发布脚本",
      "prefix": "ift_ab12cd34",
      "expiresAt": "2026-11-27T08:00:00.000Z",
      "lastUsedAt": null,
      "createdAt": "2026-08-29T08:00:00.000Z"
    }
  ]
}
```

### 创建 Token

```http
POST /api/auth/api-tokens
Content-Type: application/json

{
  "name": "CI 发布脚本",
  "expiresInDays": 90
}
```

`expiresInDays` 允许 `30`、`90`、`365` 或 `null`；省略时为 90 天，`null` 表示永不过期。响应状态为 `201`，其中 `token` 仅返回这一次：

```json
{
  "token": "ift_完整Token值",
  "apiToken": {
    "id": 12,
    "name": "CI 发布脚本",
    "prefix": "ift_ab12cd34",
    "expiresAt": "2026-11-27T08:00:00.000Z",
    "lastUsedAt": null,
    "createdAt": "2026-08-29T08:00:00.000Z"
  }
}
```

### 撤销 Token

```http
DELETE /api/auth/api-tokens/12
```

只能撤销自己的 Token，成功响应为 `204 No Content`。Token 可以撤销自身；当前请求会成功，后续请求会返回 `401`。

## 2. 使用 Bearer 认证

建议把 Token 放在环境变量中，避免进入 Shell 历史、代码仓库或日志：

```bash
export ISSUEFLOW_API_TOKEN='ift_完整Token值'
export ISSUEFLOW_API_BASE='https://issue.gldhn.top/api'
```

请求时添加标准 `Authorization` 请求头：

```bash
curl -sS "$ISSUEFLOW_API_BASE/auth/me" \
  -H "Authorization: Bearer $ISSUEFLOW_API_TOKEN"
```

不要把 Token 放在 URL 查询参数中。若请求同时携带 Bearer Token 和登录 Cookie，后端以 Bearer Token 为准；无效 Token 不会回退到 Cookie。

## 3. 常用 Issue API

以下示例均默认已设置上一节的两个环境变量。

### 修改个人资料

```bash
curl -sS -X PATCH "$ISSUEFLOW_API_BASE/auth/profile" \
  -H "Authorization: Bearer $ISSUEFLOW_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"displayName":"新的显示名称"}'
```

### 修改密码

```bash
curl -sS -X POST "$ISSUEFLOW_API_BASE/auth/change-password" \
  -H "Authorization: Bearer $ISSUEFLOW_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"currentPassword":"当前密码","newPassword":"至少八位的新密码"}'
```

成功后该账户的全部网页登录会话和 API Token 都会立即失效。当前密码错误时返回 `400 CURRENT_PASSWORD_INVALID`。

### 查询 Issue

```bash
curl -sS "$ISSUEFLOW_API_BASE/issues?page=1&pageSize=20&sort=updatedAt&order=desc" \
  -H "Authorization: Bearer $ISSUEFLOW_API_TOKEN"
```

可用查询参数：

| 参数 | 说明 |
| --- | --- |
| `state` | `OPEN` 或 `CLOSED`；省略表示全部状态。 |
| `q` | 搜索标题和正文。 |
| `authorId` | 按创建人筛选。 |
| `assigneeId` | 按负责人筛选。 |
| `labelId` | 按标签筛选。 |
| `labelIds` | 按多个标签筛选，逗号分隔；Issue 必须同时包含这些标签。 |
| `milestoneId` | 按里程碑筛选。 |
| `sort` | `createdAt` 或 `updatedAt`。 |
| `order` | `asc` 或 `desc`。 |
| `page` / `pageSize` | 页码从 1 开始；每页最多 100 条。 |

获取单个 Issue：

```bash
curl -sS "$ISSUEFLOW_API_BASE/issues/4" \
  -H "Authorization: Bearer $ISSUEFLOW_API_TOKEN"
```

### 创建 Issue

```bash
curl -sS -X POST "$ISSUEFLOW_API_BASE/issues" \
  -H "Authorization: Bearer $ISSUEFLOW_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{
    "title": "修复登录问题",
    "body": "复现步骤与期望结果",
    "assigneeIds": [],
    "labelIds": [],
    "milestoneId": null
  }'
```

普通用户是否可创建 Issue 由管理员的平台设置决定。

### 更新内容或状态

为避免覆盖他人的修改，`updatedAt` 必须使用最近一次获取 Issue 时返回的值：

```bash
curl -sS -X PATCH "$ISSUEFLOW_API_BASE/issues/4" \
  -H "Authorization: Bearer $ISSUEFLOW_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{
    "state": "CLOSED",
    "updatedAt": "2026-08-29T08:00:00.000Z"
  }'
```

状态可取 `OPEN`、`CLOSED`。内容编辑权限与网页端一致；状态、负责人、标签和里程碑的管理权限也沿用当前账户权限。版本过期时返回 `409 STALE_UPDATE`，应重新读取 Issue 后再提交。

### 添加评论

```bash
curl -sS -X POST "$ISSUEFLOW_API_BASE/issues/4/comments" \
  -H "Authorization: Bearer $ISSUEFLOW_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"body":"已完成，请验收。"}'
```

### 上传和下载附件

上传使用 `multipart/form-data`，字段名必须是 `file`。单个文件最大 10 MiB，每个 Issue 最多 20 个，文件类型不限：

```bash
curl -sS -X POST "$ISSUEFLOW_API_BASE/issues/4/attachments" \
  -H "Authorization: Bearer $ISSUEFLOW_API_TOKEN" \
  -F 'file=@./report.zip'
```

下载附件：

```bash
curl -fL "$ISSUEFLOW_API_BASE/attachments/18/content" \
  -H "Authorization: Bearer $ISSUEFLOW_API_TOKEN" \
  -o report.zip
```

## 4. 其他可用接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/auth/me` | 查询当前 Token 对应的用户。 |
| `GET` | `/api/users` | 查询可用用户。 |
| `GET` | `/api/labels` | 查询标签。 |
| `GET` | `/api/milestones` | 查询里程碑。 |
| `PUT` | `/api/issues/{id}/subscription` | 订阅或取消订阅，正文为 `{"subscribed":true}`。 |
| `GET` | `/api/issues/{id}/attachments` | 查询附件。 |
| `GET` | `/api/notifications` | 查询通知。 |
| `PATCH` | `/api/notifications/{id}/read` | 将通知标记为已读。 |
| `POST` | `/api/notifications/read-all` | 将全部通知标记为已读。 |
| `GET` | `/api/version` | 查询后端版本。 |
| `GET` | `/api/admin/stats` | 管理员统计，仅管理员 Token 可用。 |
| `GET/POST` | `/api/admin/commit-actions` | 查询或创建提交操作，仅管理后台可用。 |
| `PUT/DELETE` | `/api/admin/commit-actions/{id}` | 编辑或删除自定义提交操作；系统默认操作不可删除。 |

管理员可通过 `PATCH /api/admin/users/{id}` 并发送 `{"username":"new_username"}` 修改其他用户的用户名。用户名必须为 3–40 位，只能包含字母、数字、下划线和连字符；不能通过该接口修改当前管理员自己的用户名。

Issue 表格导出使用 `GET /api/issues/export.xlsx`，必须同时传入 ISO 8601 格式的 `closedFrom` 与 `closedTo`。开放 Issue 不受此时间范围限制，已关闭 Issue 按关闭时间筛选。下载二进制响应时可使用 `curl -OJ` 或 `-o 文件名.xlsx`。

## 5. 错误响应

错误统一返回以下结构：

```json
{
  "error": {
    "code": "API_TOKEN_INVALID",
    "message": "Invalid API token",
    "requestId": "req-1"
  }
}
```

常见状态码：

| 状态码 | 含义 |
| --- | --- |
| `400` | 请求参数校验失败。 |
| `401` | Token 无效或已过期；错误码分别为 `API_TOKEN_INVALID`、`API_TOKEN_EXPIRED`。 |
| `403` | 当前账户没有所需权限。 |
| `404` | 资源不存在，或尝试访问不属于自己的 Token。 |
| `409` | 数据版本冲突、数量达到限制或唯一值冲突。 |
| `413` | 附件超过 10 MiB。 |

排查服务端错误时，请保留响应中的 `requestId`，便于在日志中定位对应请求。

## 6. 安全建议

- 仅通过 HTTPS 发送 Token。
- 优先选择有限有效期，并为不同脚本分别创建 Token。
- 不要把 Token 写入 Git、前端构建产物、URL、截图或日志。
- CI 中使用云效等平台提供的加密变量/密钥管理能力注入 Token。
- Token 疑似泄漏时立即在 `/settings/api-tokens` 撤销并更换。
