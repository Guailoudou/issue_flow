import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommentComposer } from './CommentComposer';

describe('CommentComposer', () => {
  it('提交成功后清空输入框，失败时保留内容', async () => {
    const submit = vi.fn();
    const view = render(<CommentComposer onSubmit={submit} />);
    const input = screen.getByPlaceholderText('留下你的评论…');

    fireEvent.change(input, { target: { value: '第一条评论' } });
    fireEvent.submit(input.closest('form')!);
    view.rerender(<CommentComposer onSubmit={submit} loading />);
    view.rerender(<CommentComposer onSubmit={submit} />);
    await waitFor(() => expect(input).toHaveValue(''));

    fireEvent.change(input, { target: { value: '保留的评论' } });
    view.rerender(<CommentComposer onSubmit={submit} loading />);
    view.rerender(<CommentComposer onSubmit={submit} error="提交失败" />);
    expect(input).toHaveValue('保留的评论');
  });
});
