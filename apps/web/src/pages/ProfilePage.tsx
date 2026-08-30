import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Save, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '../components/atoms/Alert';
import { Avatar } from '../components/atoms/Avatar';
import { Button } from '../components/atoms/Button';
import { FormField } from '../components/atoms/FormField';
import { Input } from '../components/atoms/Input';
import { PasswordInput } from '../components/molecules/PasswordInput';
import { PageHeader } from '../components/molecules/PageHeader';
import { useAuth } from '../features/auth/AuthProvider';
import { setSessionUser } from '../features/auth/sessionStorage';
import { api, jsonBody } from '../lib/api';
import type { User } from '../lib/types';

export function ProfilePage() {
  const { user, logout } = useAuth();
  const client = useQueryClient();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [profileSaved, setProfileSaved] = useState(false);
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const profile = useMutation({
    mutationFn: () => api<{ user: User }>('/auth/profile', { method: 'PATCH', ...jsonBody({ displayName: displayName.trim() }) }),
    onSuccess: ({ user: updated }) => { setSessionUser(client, updated); setDisplayName(updated.displayName); setProfileSaved(true); },
  });
  const password = useMutation({
    mutationFn: () => api('/auth/change-password', { method: 'POST', ...jsonBody({ currentPassword: passwords.currentPassword, newPassword: passwords.newPassword }) }),
    onSuccess: () => void logout(),
  });
  const passwordMismatch = passwords.confirmPassword.length > 0 && passwords.newPassword !== passwords.confirmPassword;
  const canChangePassword = passwords.currentPassword.length > 0 && passwords.newPassword.length >= 8 && passwords.newPassword === passwords.confirmPassword;

  return <div className="page-container">
    <PageHeader title="个人中心" description="管理你的公开显示名称和登录密码" />
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="surface p-4 sm:p-5" aria-labelledby="profile-title">
        <div className="flex items-center gap-3"><Avatar name={user?.displayName || '用户'} /><div className="min-w-0"><h2 id="profile-title" className="font-semibold text-slate-900">个人资料</h2><p className="truncate text-sm text-slate-600">@{user?.username}</p></div></div>
        <form className="mt-5 space-y-4" onSubmit={(event) => { event.preventDefault(); setProfileSaved(false); profile.mutate(); }}>
          {profile.error && <Alert message={profile.error.message} />}
          {profileSaved && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">显示名称已更新。</p>}
          <FormField label="用户名" htmlFor="profile-username" hint="用户名只能由管理员修改"><Input id="profile-username" value={user?.username ?? ''} readOnly aria-readonly="true" aria-describedby="profile-username-hint" className="bg-slate-100" /></FormField>
          <FormField label="显示名称" htmlFor="profile-display-name" required><Input id="profile-display-name" maxLength={80} autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></FormField>
          <Button type="submit" loading={profile.isPending} disabled={!displayName.trim() || displayName.trim() === user?.displayName} icon={<Save className="size-4" aria-hidden="true" />}>保存显示名称</Button>
        </form>
      </section>

      <section className="surface p-4 sm:p-5" aria-labelledby="password-title">
        <div className="flex items-start gap-3"><span className="rounded-lg bg-brand-50 p-2 text-brand-700"><KeyRound className="size-5" aria-hidden="true" /></span><div><h2 id="password-title" className="font-semibold text-slate-900">修改密码</h2><p className="mt-1 text-sm text-slate-600">修改后全部登录会话和 API Token 都会失效，需要使用新密码重新登录。</p></div></div>
        <form className="mt-5 space-y-4" onSubmit={(event) => { event.preventDefault(); if (canChangePassword) password.mutate(); }}>
          {password.error && <Alert message={password.error.message} />}
          <FormField label="当前密码" htmlFor="current-password" required><PasswordInput id="current-password" visibilityLabel="当前密码" autoComplete="current-password" value={passwords.currentPassword} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} /></FormField>
          <FormField label="新密码" htmlFor="new-password" required hint="至少 8 位，且不能与当前密码相同"><PasswordInput id="new-password" visibilityLabel="新密码" minLength={8} autoComplete="new-password" aria-describedby="new-password-hint" value={passwords.newPassword} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} /></FormField>
          <FormField label="确认新密码" htmlFor="confirm-password" required error={passwordMismatch ? '两次输入的新密码不一致' : undefined}><PasswordInput id="confirm-password" visibilityLabel="确认新密码" minLength={8} autoComplete="new-password" aria-invalid={passwordMismatch || undefined} aria-describedby={passwordMismatch ? 'confirm-password-error' : undefined} value={passwords.confirmPassword} onChange={(event) => setPasswords({ ...passwords, confirmPassword: event.target.value })} /></FormField>
          <Button type="submit" loading={password.isPending} disabled={!canChangePassword} icon={<UserRound className="size-4" aria-hidden="true" />}>修改密码并重新登录</Button>
        </form>
      </section>
    </div>
  </div>;
}
