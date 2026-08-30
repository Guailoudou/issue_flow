export const formatDate = (value?: string | null) => value
  ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '—';

export const initials = (name: string) => name.trim().slice(0, 2).toUpperCase();
