import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { MarkdownEditor } from './MarkdownEditor';

function Harness({ upload }: { upload: (file: File) => Promise<string> }) {
  const [value, setValue] = useState('hello');
  return <MarkdownEditor id="body" value={value} onChange={setValue} onPasteImage={upload} />;
}

it('格式化选中文本并将粘贴图片替换为 Markdown 引用', async () => {
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000000');
  const upload = vi.fn().mockResolvedValue('/api/attachments/7/content');
  render(<Harness upload={upload} />);
  const editor = screen.getByRole('textbox') as HTMLTextAreaElement;

  editor.setSelectionRange(0, 5);
  fireEvent.click(screen.getByRole('button', { name: '粗体' }));
  expect(editor).toHaveValue('**hello**');

  editor.setSelectionRange(editor.value.length, editor.value.length);
  const image = new File(['image'], 'screen.png', { type: 'image/png' });
  fireEvent.paste(editor, { clipboardData: { files: [image] } });

  await waitFor(() => expect(editor).toHaveValue('**hello**![screen.png](/api/attachments/7/content)'));
  expect(upload).toHaveBeenCalledWith(image);
});
