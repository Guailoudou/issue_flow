import { ApiError } from './api';

const DEFAULT_FILE_NAME = 'Issue需求进度表.xlsx';

export function fileNameFromDisposition(value: string | null, fallback = DEFAULT_FILE_NAME) {
  if (!value) return fallback;
  const encoded = value.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded).replace(/[\\/]/g, '_'); } catch { return fallback; }
  }
  const plain = value.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
  return (plain?.[1] || plain?.[2])?.trim().replace(/[\\/]/g, '_') || fallback;
}

export async function downloadApiFile(path: string, fallbackFileName = DEFAULT_FILE_NAME) {
  const response = await fetch(`/api${path}`, { credentials: 'include' });
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined);
    const detail = payload?.error;
    throw new ApiError(response.status, detail?.message || '导出失败，请稍后重试', detail?.code, detail?.requestId);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileNameFromDisposition(response.headers.get('Content-Disposition'), fallbackFileName);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return anchor.download;
}
