import type { User } from '../../lib/types';
import { Checkbox } from '../atoms/Checkbox';
import { Avatar } from '../atoms/Avatar';
export function UserPicker({ users, value, onChange, disabled }: { users: User[]; value: number[]; onChange: (ids: number[]) => void; disabled?: boolean }) {
  if (!users.length) return <p className="text-sm text-slate-500">暂无可指派用户</p>;
  return <div className="max-h-52 space-y-1 overflow-auto" role="group" aria-label="选择负责人">{users.map((user) => <label key={user.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 hover:bg-slate-50"><Checkbox checked={value.includes(user.id)} disabled={disabled || !user.active} onChange={(e) => onChange(e.target.checked ? [...value, user.id] : value.filter((id) => id !== user.id))} /><Avatar name={user.displayName} src={user.avatarUrl} size="sm" /><span className="min-w-0 flex-1 truncate text-sm">{user.displayName}</span><span className="text-xs text-slate-500">@{user.username}</span></label>)}</div>;
}
