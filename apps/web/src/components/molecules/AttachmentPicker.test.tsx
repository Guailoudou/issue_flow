import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttachmentPicker, MAX_ATTACHMENT_COUNT, MAX_ATTACHMENT_SIZE, validateAttachments } from './AttachmentPicker';

function Harness() { const [files, setFiles] = useState<File[]>([]); return <AttachmentPicker value={files} onChange={setFiles} />; }

describe('AttachmentPicker', () => {
  afterEach(() => vi.restoreAllMocks());

  it('接受图片和非图片文件，并可移除', () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:preview') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const { container } = render(<Harness />);
    const image = new File(['image'], 'screen.png', { type: 'image/png' });
    const archive = new File(['archive'], 'logs.zip', { type: 'application/zip' });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [image, archive] } });
    expect(screen.getByRole('img', { name: 'screen.png' })).toHaveAttribute('src', 'blob:preview');
    expect(screen.getByTitle('logs.zip')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移除 logs.zip' }));
    expect(screen.queryByTitle('logs.zip')).not.toBeInTheDocument();
  });

  it('仅拒绝超过 10 MiB 的文件', () => {
    const { container } = render(<Harness />); const input = container.querySelector('input[type="file"]')!;
    const large = new File(['x'], 'large.bin', { type: 'application/octet-stream' }); Object.defineProperty(large, 'size', { value: MAX_ATTACHMENT_SIZE + 1 });
    fireEvent.change(input, { target: { files: [large] } });
    expect(screen.getByRole('alert')).toHaveTextContent('超过 10 MiB');
  });

  it('从剪贴板添加文件和图片并显示反馈', () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:pasted-preview') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    render(<Harness />);
    const image = new File(['image'], 'clipboard.png', { type: 'image/png' });
    const document = new File(['document'], 'clipboard.pdf', { type: 'application/pdf' });

    fireEvent.paste(screen.getByRole('group', { name: '附件粘贴与拖拽区域' }), { clipboardData: { files: [image, document] } });

    expect(screen.getByRole('status')).toHaveTextContent('已通过粘贴添加 2 个附件');
    expect(screen.getByRole('img', { name: 'clipboard.png' })).toHaveAttribute('src', 'blob:pasted-preview');
    expect(screen.getByTitle('clipboard.pdf')).toBeInTheDocument();
  });

  it('不拦截没有文件的文字粘贴', () => {
    render(<Harness />);
    const zone = screen.getByRole('group', { name: '附件粘贴与拖拽区域' });
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { files: [] } });

    zone.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('拖入文件时高亮并在放下后加入列表', () => {
    render(<Harness />);
    const zone = screen.getByRole('group', { name: '附件粘贴与拖拽区域' });
    const archive = new File(['archive'], 'dropped.zip', { type: 'application/zip' });
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'], files: [] } });
    expect(zone).toHaveClass('border-brand-600', 'bg-brand-50');

    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [archive] } });

    expect(zone).not.toHaveClass('bg-brand-50');
    expect(screen.getByRole('status')).toHaveTextContent('已通过拖拽添加 1 个附件');
    expect(screen.getByTitle('dropped.zip')).toBeInTheDocument();
  });

  it('不拦截没有文件的拖拽内容', () => {
    render(<Harness />);
    const zone = screen.getByRole('group', { name: '附件粘贴与拖拽区域' });
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['text/plain'], files: [] } });

    zone.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('粘贴与选择文件共用数量限制', () => {
    const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')];
    const result = validateAttachments(files, MAX_ATTACHMENT_COUNT - 1);
    expect(result.accepted).toHaveLength(1);
    expect(result.errors).toContain(`每个 Issue 最多可上传 ${MAX_ATTACHMENT_COUNT} 个附件`);
  });
});
