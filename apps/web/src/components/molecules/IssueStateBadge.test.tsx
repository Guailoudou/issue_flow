import { render, screen } from '@testing-library/react';
import { IssueStateBadge } from './IssueStateBadge';

describe('IssueStateBadge', () => {
  it.each([
    ['OPEN', '开放'],
    ['CLOSED', '已关闭'],
  ] as const)('展示 %s 状态的文字标签', (status, label) => {
    render(<IssueStateBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
