const pendingUrls = new WeakMap<File, string>();

export function pendingImageUrl(file: File) {
  let url = pendingUrls.get(file);
  if (!url) {
    url = `issueflow-pending-image:${crypto.randomUUID()}`;
    pendingUrls.set(file, url);
  }
  return url;
}

export function replacePendingImage(body: string, file: File, replacement: string) {
  const pending = pendingUrls.get(file);
  return pending ? body.replaceAll(pending, replacement) : body;
}

export function removePendingImage(body: string, file: File) {
  const pending = pendingUrls.get(file);
  if (!pending) return body;
  const escaped = pending.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body.replace(new RegExp(`!?\\[[^\\]]*\\]\\(${escaped}\\)`, 'g'), '');
}

export const stripPendingImages = (body: string) => body.replace(/!?\[[^\]]*\]\(issueflow-pending-image:[^)]+\)/g, '');
