import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadApiFile, fileNameFromDisposition } from './download';

describe('二进制文件下载', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('解析 UTF-8 文件名并触发下载', async () => {
    expect(fileNameFromDisposition("attachment; filename*=UTF-8''%E9%9C%80%E6%B1%82.xlsx")).toBe('需求.xlsx');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const createObjectURL = vi.fn(() => 'blob:export'); const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['xlsx']), { headers: { 'Content-Disposition': "attachment; filename*=UTF-8''%E3%80%90%E9%9C%80%E6%B1%82%E8%BF%9B%E5%BA%A6%E8%A1%A8%E3%80%91.xlsx" } })));
    expect(await downloadApiFile('/issues/export.xlsx?state=OPEN')).toBe('【需求进度表】.xlsx');
    expect(fetch).toHaveBeenCalledWith('/api/issues/export.xlsx?state=OPEN', { credentials: 'include' });
    expect(click).toHaveBeenCalledOnce(); expect(revokeObjectURL).toHaveBeenCalledWith('blob:export');
  });

  it('缺少文件名时使用默认名称', () => expect(fileNameFromDisposition(null)).toBe('Issue需求进度表.xlsx'));
});
