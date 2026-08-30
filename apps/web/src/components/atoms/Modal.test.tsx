import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';

function ControlledModal({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState('');
  return <Modal open title="创建普通用户" onClose={() => onClose()}>
    <label htmlFor="username">用户名</label>
    <input id="username" value={value} onChange={(event) => setValue(event.target.value)} />
  </Modal>;
}

describe('Modal', () => {
  it('受控表单重新渲染时保持输入焦点', async () => {
    const user = userEvent.setup();
    render(<ControlledModal onClose={vi.fn()} />);
    const input = screen.getByLabelText('用户名');

    await user.click(input);
    await user.type(input, 'admin-user');

    expect(input).toHaveValue('admin-user');
    expect(input).toHaveFocus();
  });

  it('按 Escape 仍可关闭对话框', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ControlledModal onClose={onClose} />);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
