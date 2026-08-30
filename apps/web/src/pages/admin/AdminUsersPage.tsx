import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus, ShieldCheck, UserCheck, UserX } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '../../components/atoms/Alert';
import { Avatar } from '../../components/atoms/Avatar';
import { Button } from '../../components/atoms/Button';
import { Checkbox } from '../../components/atoms/Checkbox';
import { FormField } from '../../components/atoms/FormField';
import { Input } from '../../components/atoms/Input';
import { Modal } from '../../components/atoms/Modal';
import { Spinner } from '../../components/atoms/Spinner';
import { ErrorPanel } from '../../components/molecules/ErrorPanel';
import { PageHeader } from '../../components/molecules/PageHeader';
import { PasswordInput } from '../../components/molecules/PasswordInput';
import { useAuth } from '../../features/auth/AuthProvider';
import { api, jsonBody } from '../../lib/api';
import type { BusinessRole, User } from '../../lib/types';

type UserForm = { username: string; displayName: string; email: string; password: string };
const empty: UserForm = { username: '', displayName: '', email: '', password: '' };
const roleOptions: Array<{ value: BusinessRole; label: string }> = [{ value: 'MANAGEMENT', label: '管理' }, { value: 'DEVELOPMENT', label: '开发' }, { value: 'PRODUCT', label: '产品' }];

export function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [roleUser, setRoleUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<BusinessRole[]>([]);
  const [form, setForm] = useState(empty);
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const query = useQuery({ queryKey: ['admin-users'], queryFn: async () => (await api<{ items: User[] }>('/users')).items });
  const refresh = () => void client.invalidateQueries({ queryKey: ['admin-users'] });
  const create = useMutation({ mutationFn: () => api('/admin/users', { method: 'POST', ...jsonBody(form) }), onSuccess: () => { refresh(); setCreating(false); setForm(empty); } });
  const toggle = useMutation({ mutationFn: (user: User) => api(`/admin/users/${user.id}`, { method: 'PATCH', ...jsonBody({ active: !user.active }) }), onSuccess: refresh });
  const reset = useMutation({ mutationFn: () => api(`/admin/users/${resetUser?.id}/reset-password`, { method: 'POST', ...jsonBody({ password }) }), onSuccess: () => { setResetUser(null); setPassword(''); } });
  const rename = useMutation({ mutationFn: () => api(`/admin/users/${editUser?.id}`, { method: 'PATCH', ...jsonBody({ username: username.trim() }) }), onSuccess: () => { refresh(); setEditUser(null); setUsername(''); } });
  const updateRoles = useMutation({ mutationFn: () => api(`/admin/users/${roleUser?.id}/roles`, { method: 'PUT', ...jsonBody({ roles }) }), onSuccess: () => { refresh(); setRoleUser(null); } });
  const openRename = (user: User) => { rename.reset(); setEditUser(user); setUsername(user.username); };
  const openRoles = (user: User) => { updateRoles.reset(); setRoleUser(user); setRoles(user.roles?.length ? user.roles : ['DEVELOPMENT']); };

  return <>
    <PageHeader title="用户管理" description="创建账号、修改用户名、控制访问状态和重置密码" actions={<Button icon={<Plus className="size-4" aria-hidden="true" />} onClick={() => setCreating(true)}>创建用户</Button>} />
    <div className="surface overflow-hidden">
      {query.isPending ? <Spinner /> : query.isError ? <ErrorPanel message={query.error.message} onRetry={() => void query.refetch()} /> : <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr><th className="px-4 py-3 font-semibold">用户</th><th className="px-4 py-3 font-semibold">邮箱</th><th className="px-4 py-3 font-semibold">角色</th><th className="px-4 py-3 font-semibold">状态</th><th className="px-4 py-3 text-right font-semibold">操作</th></tr></thead><tbody className="divide-y">{query.data.map((user) => <tr key={user.id}><td className="px-4 py-3"><div className="flex items-center gap-2"><Avatar name={user.displayName} size="sm" /><div><p className="font-medium">{user.displayName}</p><p className="text-xs text-slate-500">@{user.username}</p></div></div></td><td className="px-4 py-3 text-slate-600">{user.email || '—'}</td><td className="px-4 py-3"><div className="flex flex-wrap gap-1">{user.role === 'ADMIN' && <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs text-white">管理员</span>}{(user.roles?.length ? user.roles : ['DEVELOPMENT']).map((role) => <span key={role} className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs text-brand-900">{roleOptions.find((item) => item.value === role)?.label}</span>)}</div></td><td className="px-4 py-3"><span className={user.active ? 'text-emerald-700' : 'text-red-700'}>{user.active ? '已启用' : '已停用'}</span></td><td className="px-4 py-3"><div className="flex justify-end gap-1">{currentUser?.role === 'ADMIN' && <Button variant="ghost" icon={<ShieldCheck className="size-4" aria-hidden="true" />} onClick={() => openRoles(user)}>编辑角色</Button>}<Button variant="ghost" disabled={user.id === currentUser?.id} title={user.id === currentUser?.id ? '不能在此修改自己的用户名' : undefined} icon={<Pencil className="size-4" aria-hidden="true" />} onClick={() => openRename(user)}>编辑用户名</Button><Button variant="ghost" icon={<KeyRound className="size-4" aria-hidden="true" />} onClick={() => setResetUser(user)}>重置密码</Button><Button variant="ghost" disabled={user.role === 'ADMIN'} loading={toggle.isPending && toggle.variables?.id === user.id} icon={user.active ? <UserX className="size-4" aria-hidden="true" /> : <UserCheck className="size-4" aria-hidden="true" />} onClick={() => toggle.mutate(user)}>{user.active ? '停用' : '启用'}</Button></div></td></tr>)}</tbody></table></div>}
    </div>

    <Modal open={creating} title="创建普通用户" onClose={() => setCreating(false)}><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>{create.error && <Alert message={create.error.message} />}<FormField label="用户名" htmlFor="new-username" required hint="3–40 位，仅支持字母、数字、下划线和连字符"><Input id="new-username" autoComplete="off" aria-describedby="new-username-hint" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></FormField><FormField label="显示名称" htmlFor="new-display-name" required><Input id="new-display-name" autoComplete="name" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></FormField><FormField label="邮箱" htmlFor="new-email"><Input id="new-email" type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></FormField><FormField label="初始密码" htmlFor="new-user-password" required hint="至少 8 位"><PasswordInput id="new-user-password" visibilityLabel="初始密码" minLength={8} autoComplete="new-password" aria-describedby="new-user-password-hint" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></FormField><Button className="w-full" type="submit" loading={create.isPending} disabled={!form.username.trim() || !form.displayName.trim() || form.password.length < 8}>创建用户</Button></form></Modal>

    <Modal open={!!editUser} title={`修改 ${editUser?.displayName ?? ''} 的用户名`} onClose={() => { setEditUser(null); setUsername(''); }}><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); rename.mutate(); }}>{rename.error && <Alert message={rename.error.message} />}<FormField label="用户名" htmlFor="edit-username" required hint="修改后，该用户下次登录必须使用新用户名"><Input id="edit-username" autoComplete="off" minLength={3} maxLength={40} pattern="[a-zA-Z0-9_-]+" aria-describedby="edit-username-hint" value={username} onChange={(event) => setUsername(event.target.value)} /></FormField><Button className="w-full" type="submit" loading={rename.isPending} disabled={!username.trim() || username.trim() === editUser?.username}>保存用户名</Button></form></Modal>

    <Modal open={!!roleUser} title={`设置 ${roleUser?.displayName ?? ''} 的角色`} onClose={() => setRoleUser(null)}><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); updateRoles.mutate(); }}>{updateRoles.error && <Alert message={updateRoles.error.message} />}<fieldset><legend className="mb-2 text-sm font-semibold">可同时选择多个角色</legend><div className="space-y-1">{roleOptions.map((option) => <label key={option.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 transition-colors hover:bg-slate-50"><Checkbox checked={roles.includes(option.value)} onChange={(event) => setRoles(event.target.checked ? [...roles, option.value] : roles.filter((role) => role !== option.value))} /><span>{option.label}</span></label>)}</div></fieldset><Button className="w-full" type="submit" loading={updateRoles.isPending} disabled={!roles.length}>保存角色</Button></form></Modal>

    <Modal open={!!resetUser} title={`重置 ${resetUser?.displayName ?? ''} 的密码`} onClose={() => setResetUser(null)}><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); reset.mutate(); }}>{reset.error && <Alert message={reset.error.message} />}<FormField label="新密码" htmlFor="reset-password" required hint="重置后该用户现有会话和 API Token 将失效"><PasswordInput id="reset-password" visibilityLabel="重置密码" minLength={8} autoComplete="new-password" aria-describedby="reset-password-hint" value={password} onChange={(event) => setPassword(event.target.value)} /></FormField><Button className="w-full" type="submit" loading={reset.isPending} disabled={password.length < 8}>确认重置</Button></form></Modal>
  </>;
}
