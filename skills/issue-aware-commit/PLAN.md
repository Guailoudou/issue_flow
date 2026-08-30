# Issue 关联规范提交 Skill 方案

## 目标

在用户明确要求提交时，先通过 IssueFlow 查询或创建与本次变更匹配的 Issue，再根据目标和验收标准的覆盖情况生成中文 Conventional Commit，并仅提交本次任务范围。

## 已确认规则

- Skill 位于 `.agents/skills/issue-aware-commit/`，允许在明确提交请求中自动发现。
- `issue/config.toml` 必须包含 `API_BASE_URL` 和 `API_TOKEN`，并由根 `.gitignore` 精确忽略；字段缺失或为空时补齐空配置并停止，等待用户填写。
- 只查询 `OPEN` 和 `AWAITING_ACCEPTANCE` Issue；多个同等候选交由用户选择，没有匹配项时自动创建。
- 自动创建前只展示标题，正文包含背景、当前表现、目标、验收标准和涉及路径。
- 新 Issue 的唯一负责人是 API Token 对应的当前用户，不更新既有 Issue 的状态、评论或负责人。
- Issue 标题前缀由 Conventional Commit 类型固定映射，例如 `fix` 对应 `[bug]`、`feat` 对应 `[feature]`。
- Issue 目标和验收标准均被本次改动覆盖时使用 `#a编号`；否则列出未覆盖内容并使用 `#编号`。
- 提交信息使用中文 Conventional Commits，只暂存本次任务文件，不推送、合并、发布或关闭 Issue。

## 验收

- Skill 官方结构校验通过。
- 任务合同结构与实际变更范围检查通过。
- 仓库 governance profile 的机器检查全部通过。
- `issue/config.toml` 仅在首次实际调用 Skill 时创建并保持本地忽略，不纳入提交。
