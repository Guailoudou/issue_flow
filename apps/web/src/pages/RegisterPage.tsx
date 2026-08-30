import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Alert } from '../components/atoms/Alert';
import { Button } from '../components/atoms/Button';
import { FormField } from '../components/atoms/FormField';
import { Input } from '../components/atoms/Input';
import { AuthPageLayout } from '../components/organisms/AuthPageLayout';
import { useAuth } from '../features/auth/AuthProvider';
import { setSessionUser } from '../features/auth/sessionStorage';
import { api, jsonBody } from '../lib/api';
import type { User } from '../lib/types';

const schema = z.object({
  username: z.string().trim().min(3, '用户名至少 3 位').max(40, '用户名最多 40 位').regex(/^[a-zA-Z0-9_-]+$/, '仅支持英文字母、数字、下划线和连字符'),
  displayName: z.string().trim().min(1, '请输入显示名称').max(80, '显示名称最多 80 位'),
  email: z.union([z.literal(''), z.string().email('请输入有效邮箱').max(254, '邮箱最多 254 位')]),
  password: z.string().min(8, '密码至少 8 位').max(128, '密码最多 128 位'),
  inviteCode: z.string().trim().min(1, '请输入邀请码').max(4000, '邀请码过长'),
});
type RegisterValues = z.infer<typeof schema>;

export function RegisterPage() {
  const { user, settings } = useAuth(); const navigate = useNavigate(); const queryClient = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<RegisterValues>({ resolver: zodResolver(schema), defaultValues: { username: '', displayName: '', email: '', password: '', inviteCode: '' } });
  const mutation = useMutation({ mutationFn: async (values: RegisterValues) => (await api<{ user: User }>('/auth/register', { method: 'POST', ...jsonBody(values) })).user, onSuccess: (value) => { setSessionUser(queryClient, value); navigate('/issues', { replace: true }); } });
  if (user) return <Navigate to="/issues" replace />;
  return <AuthPageLayout platformName={settings.platformName} platformDescription={settings.description} title="创建账号" description="使用邀请码加入 Issue 协作" footer={<>已有账号？ <Link className="font-semibold text-brand-700 underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600" to="/login">返回登录</Link></>}>
    <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="mt-7 space-y-4">
      {mutation.error && <Alert message={mutation.error.message} />}
      <FormField label="用户名" htmlFor="register-username" error={errors.username?.message} required><Input id="register-username" autoComplete="username" autoFocus aria-invalid={!!errors.username} aria-describedby={errors.username ? 'register-username-error' : undefined} {...register('username')} /></FormField>
      <FormField label="显示名称" htmlFor="register-display-name" error={errors.displayName?.message} required><Input id="register-display-name" autoComplete="name" aria-invalid={!!errors.displayName} aria-describedby={errors.displayName ? 'register-display-name-error' : undefined} {...register('displayName')} /></FormField>
      <FormField label="邮箱" htmlFor="register-email" error={errors.email?.message}><Input id="register-email" type="email" autoComplete="email" aria-invalid={!!errors.email} aria-describedby={errors.email ? 'register-email-error' : undefined} {...register('email')} /></FormField>
      <FormField label="密码" htmlFor="register-password" error={errors.password?.message} hint="至少 8 位" required><Input id="register-password" type="password" autoComplete="new-password" minLength={8} aria-invalid={!!errors.password} aria-describedby={errors.password ? 'register-password-error' : 'register-password-hint'} {...register('password')} /></FormField>
      <FormField label="邀请码" htmlFor="register-invite-code" error={errors.inviteCode?.message} hint="请向管理员获取" required><Input id="register-invite-code" type="password" autoComplete="off" aria-invalid={!!errors.inviteCode} aria-describedby={errors.inviteCode ? 'register-invite-code-error' : 'register-invite-code-hint'} {...register('inviteCode')} /></FormField>
      <Button type="submit" loading={mutation.isPending} className="w-full">注册并登录</Button>
    </form>
  </AuthPageLayout>;
}
