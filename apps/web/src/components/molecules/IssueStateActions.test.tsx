import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { IssueStateActions } from './IssueStateActions';

describe('IssueStateActions', () => {
  it('从开放状态可关闭', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<IssueStateActions status="OPEN" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: '关闭 Issue' }));
    expect(onChange).toHaveBeenCalledWith('CLOSED');
    expect(screen.queryByRole('button', { name: '重新打开' })).not.toBeInTheDocument();
  });

  it('关闭状态可重新打开', () => {
    render(<IssueStateActions status="CLOSED" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: '重新打开' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '关闭 Issue' })).not.toBeInTheDocument();
  });
});
