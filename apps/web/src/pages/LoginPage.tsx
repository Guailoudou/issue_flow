import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LockKeyhole, UserRound } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
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

const schema = z.object({ username: z.string().min(1, '请输入用户名'), password: z.string().min(1, '请输入密码') });
type LoginValues = z.infer<typeof schema>;

export function LoginPage() {
  const { user, settings } = useAuth(); const navigate = useNavigate(); const location = useLocation(); const queryClient = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<LoginValues>({ resolver: zodResolver(schema) });
  const mutation = useMutation({ mutationFn: async (values: LoginValues) => (await api<{ user: User }>('/auth/login', { method: 'POST', ...jsonBody(values) })).user, onSuccess: (value) => { setSessionUser(queryClient, value); const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname; navigate(from || '/issues', { replace: true }); } });
  if (user) return <Navigate to="/issues" replace />;
  return <AuthPageLayout platformName={settings.platformName} platformDescription={settings.description} title="欢迎回来" description="登录以继续处理 Issue" footer={<>还没有账号？ <Link className="font-semibold text-brand-700 underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600" to="/register">使用邀请码注册</Link></>}>
    <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="mt-7 space-y-5">
      {mutation.error && <Alert message={mutation.error.message} />}
      <FormField label="用户名" htmlFor="username" error={errors.username?.message}><div className="relative"><UserRound className="absolute left-3 top-3.5 size-4 text-slate-400" aria-hidden="true" /><Input id="username" autoComplete="username" autoFocus className="pl-9" aria-invalid={!!errors.username} {...register('username')} /></div></FormField>
      <FormField label="密码" htmlFor="password" error={errors.password?.message}><div className="relative"><LockKeyhole className="absolute left-3 top-3.5 size-4 text-slate-400" aria-hidden="true" /><Input id="password" type="password" autoComplete="current-password" className="pl-9" aria-invalid={!!errors.password} {...register('password')} /></div></FormField>
      <Button type="submit" loading={mutation.isPending} className="w-full">登录</Button>
    </form>
  </AuthPageLayout>;
}
