import { initials } from '../../lib/format';
export function Avatar({ name, src, size = 'md' }: { name: string; src?: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'size-7 text-xs', md: 'size-9 text-sm', lg: 'size-12 text-base' };
  return src
    ? <img src={src} alt={`${name} 的头像`} className={`${sizes[size]} shrink-0 rounded-full object-cover`} />
    : <span aria-label={`${name} 的头像`} className={`${sizes[size]} inline-flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-900`}>{initials(name)}</span>;
}
