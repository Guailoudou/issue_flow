import { render, screen } from '@testing-library/react';
import { Timeline } from './Timeline';

const actor = { id: 1, username: 'admin', displayName: '管理员', role: 'ADMIN' as const, active: true };

describe('Timeline', () => {
  it('明确展示由云效提交触发的关闭和重新打开事件', () => {
    render(<Timeline events={[
      { id: 1, type: 'ISSUE_CLOSED_BY_YUNXIAO_COMMIT', actor, createdAt: '2026-08-29T00:00:00.000Z' },
      { id: 2, type: 'ISSUE_REOPENED_BY_YUNXIAO_COMMIT', actor, createdAt: '2026-08-29T01:00:00.000Z' },
      { id: 3, type: 'LABELS_CHANGED', actor, createdAt: '2026-08-29T02:00:00.000Z' },
    ]} />);

    expect(screen.getByText('通过云效提交关闭了 Issue')).toBeInTheDocument();
    expect(screen.getByText('通过云效提交重新打开了 Issue')).toBeInTheDocument();
    expect(screen.getByText('更新了标签')).toBeInTheDocument();
  });
});
