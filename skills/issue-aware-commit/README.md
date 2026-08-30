# Issue 关联规范提交

这个 Skill 用于在用户明确要求提交代码时，将本次改动关联到 IssueFlow Issue，并生成带 Issue 编号的中文 Conventional Commit。

## 主要能力

- 检查工作区，只暂存本次任务相关文件。
- 查询开放或待验收的 Issue，匹配不到时创建新 Issue。
- 根据目标和验收标准的覆盖情况选择 `#编号` 或 `#a编号`。
- 生成 `<type>(<scope>): <中文摘要> <Issue 标签>` 格式的提交信息。
- 完成本地提交，但不会自动推送、合并、关闭 Issue 或修改 Issue 状态。

## 使用前准备

首次运行时，Skill 会检查仓库根目录的 `issue/config.toml`：

```toml
API_BASE_URL = ""
API_TOKEN = ""
```

该文件必须被根 `.gitignore` 中的 `/issue/config.toml` 规则忽略。填写 IssueFlow 的 HTTPS API 基础地址和有效 API Token 后，需要重新发起提交请求。

## 使用方式

在已加载此 Skill 的 Codex 会话中明确要求提交，例如：

```text
使用 $issue-aware-commit 提交当前任务改动
```

Skill 会依次确认提交范围、验证 Token、查找或创建 Issue、判断覆盖情况、运行必要检查并创建本地提交。遇到多个同等相关 Issue、无效 Token、网络错误或范围不明时会停止并请求处理，不会猜测或降级提交。

## 文件说明

- `SKILL.md`：Skill 的触发条件、完整工作流和安全约束。
- `agents/openai.yaml`：Codex UI 展示名称、简介和默认提示词。
- `PLAN.md`：设计目标与验收记录。

## 安全边界

- API 基础地址通过本地配置提供，不在 Skill 中硬编码服务域名。
- API Token 不得进入日志、提交信息、URL、临时文件或 Git。
- 不使用 `git add .` 或 `git add -A`。
- API 查询失败时不会创建 Issue，避免重复或错误关联。
- 不自动推送、合并、发布、关闭 Issue 或更新既有 Issue。
