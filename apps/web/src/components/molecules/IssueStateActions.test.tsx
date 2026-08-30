import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { IssueStateActions } from './IssueStateActions';

describe('IssueStateActions', () => {
  it('从开放状态可进入待验收或关闭状态', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<IssueStateActions status="OPEN" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: '标记待验收' }));
    await user.click(screen.getByRole('button', { name: '关闭 Issue' }));
    expect(onChange).toHaveBeenNthCalledWith(1, 'AWAITING_ACCEPTANCE');
    expect(onChange).toHaveBeenNthCalledWith(2, 'CLOSED');
  });

  it('待验收状态可重新打开或关闭', () => {
    render(<IssueStateActions status="AWAITING_ACCEPTANCE" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: '重新打开' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭 Issue' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '标记待验收' })).not.toBeInTheDocument();
  });
});
