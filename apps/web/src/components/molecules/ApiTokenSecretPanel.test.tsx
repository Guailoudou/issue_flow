import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiTokenSecretPanel } from './ApiTokenSecretPanel';

describe('ApiTokenSecretPanel', () => {
  it('copies the one-time token and can be dismissed', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const onDismiss = vi.fn();

    render(<ApiTokenSecretPanel token="ift_one-time-secret" onDismiss={onDismiss} />);

    expect(screen.getByText('ift_one-time-secret')).toBeInTheDocument();
    expect(screen.getByText('该 Token 只显示一次，关闭后无法再次查看。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '复制 Token' }));
    expect(writeText).toHaveBeenCalledWith('ift_one-time-secret');
    expect(screen.getByRole('button', { name: '已复制' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '我已保存，关闭' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
