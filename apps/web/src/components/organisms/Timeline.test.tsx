import { render, screen } from '@testing-library/react';
import { Timeline } from './Timeline';

const actor = { id: 1, username: 'admin', displayName: '管理员', role: 'ADMIN' as const, active: true };
const createdAt = '2026-08-29T00:00:00.000Z';

describe('Timeline', () => {
  it('像 GitHub 一样明确展示每项变更内容', () => {
    render(<Timeline
      users={[actor, { id: 2, username: 'alice', displayName: 'Alice', role: 'USER', active: true }]}
      labels={[{ id: 3, name: 'bug', color: 'd73a4a' }, { id: 4, name: '待验收', color: 'f59e0b' }]}
      milestones={[{ id: 5, title: 'v1.0' }, { id: 6, title: 'v1.1' }]}
      events={[
        { id: 1, type: 'ISSUE_EDITED', actor, createdAt, data: { title: { from: '旧标题', to: '新标题' }, bodyChanged: true } },
        { id: 2, type: 'ASSIGNEES_CHANGED', actor, createdAt, data: { product: { added: [2], removed: [] }, development: { added: [], removed: [1] } } },
        { id: 3, type: 'LABELS_CHANGED', actor, createdAt, data: { added: [3], removed: [4] } },
        { id: 4, type: 'MILESTONE_CHANGED', actor, createdAt, data: { from: 5, to: 6 } },
        { id: 5, type: 'ATTACHMENT_ADDED', actor, createdAt, data: { fileName: 'design.png' } },
        { id: 6, type: 'ISSUE_CLOSED_BY_YUNXIAO_MR', actor, createdAt, data: { title: '修复登录流程' } },
        { id: 7, type: 'COMMENT_CREATED', actor, createdAt, comment: { id: 7, body: '![截图](https://example.com/image.png)', author: actor, createdAt } },
        { id: -8, type: 'YUNXIAO_COMMIT_REFERENCED', actor: { ...actor, displayName: 'Alice' }, createdAt, data: { title: 'fix: 修复登录', url: 'https://codeup.example.com/commit/123', status: 'PUSHED', sourceBranch: 'fix/login', commitSha: '1234567890abcdef' } },
      ]}
    />);

    expect(screen.getByText('将标题从“旧标题”改为“新标题”，并修改了描述')).toBeInTheDocument();
    expect(screen.getByText('添加产品负责人 Alice；移除开发负责人 管理员')).toBeInTheDocument();
    expect(screen.getByText('添加标签')).toBeInTheDocument();
    expect(screen.getByText('移除标签')).toBeInTheDocument();
    expect(screen.getByText('bug')).toHaveStyle({ borderColor: '#d73a4a' });
    expect(screen.getByText('待验收')).toHaveStyle({ borderColor: '#f59e0b' });
    expect(screen.getByText('将里程碑从“v1.0”改为“v1.1”')).toBeInTheDocument();
    expect(screen.getByText('添加了附件“design.png”')).toBeInTheDocument();
    expect(screen.getByText('通过云效合并请求关闭了 Issue：“修复登录流程”')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /fix: 修复登录/ })).toHaveAttribute('href', 'https://codeup.example.com/commit/123');
    expect(screen.getByText('fix/login')).toBeInTheDocument();
    expect(screen.getByText('12345678')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '截图' }).closest('.comment-markdown')).toBeInTheDocument();
  });
});
