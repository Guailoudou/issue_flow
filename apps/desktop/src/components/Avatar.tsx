import { getAvatarColorClass, getInitials } from '../lib/utils';

export function Avatar({
  name,
  size = 'sm',
}: {
  name: string;
  size?: 'xs' | 'sm' | 'md';
}) {
  const sizeClasses = {
    xs: 'size-4 text-[9px]',
    sm: 'size-5 text-[10px]',
    md: 'size-7 text-xs',
  };

  const initials = getInitials(name);
  const colorClass = getAvatarColorClass(name);

  return (
    <div
      title={name}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-medium ${colorClass} ${sizeClasses[size]}`}
      aria-label={name}
    >
      {initials}
    </div>
  );
}
