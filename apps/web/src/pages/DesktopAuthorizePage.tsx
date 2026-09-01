import type {
  DesktopPairingApprovalResponse,
  DesktopPairingVerification,
} from '@issueflow/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Laptop, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert } from '../components/atoms/Alert';
import { Button } from '../components/atoms/Button';
import { FormField } from '../components/atoms/FormField';
import { Input } from '../components/atoms/Input';
import { Spinner } from '../components/atoms/Spinner';
import { useAuth } from '../features/auth/AuthProvider';
import { api, jsonBody } from '../lib/api';

export function DesktopAuthorizePage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const codeParam = searchParams.get('code') || '';
  const [manualCode, setManualCode] = useState('');
  const activeCode = (codeParam || manualCode).trim().toUpperCase();

  const verifyQuery = useQuery({
    queryKey: ['desktop-pairing-verify', activeCode],
    queryFn: async () => {
      if (!activeCode) return null;
      return api<DesktopPairingVerification>(`/desktop/pairings/verify?code=${encodeURIComponent(activeCode)}`);
    },
    enabled: activeCode.length >= 8,
    retry: false,
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      return api<DesktopPairingApprovalResponse>('/desktop/pairings/approve', {
        method: 'POST',
        ...jsonBody({ code: activeCode }),
      });
    },
    onSuccess: () => {
      verifyQuery.refetch();
    },
  });

  const isApproved = Boolean(verifyQuery.data?.approvedAt || approveMutation.isSuccess);

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-teal-200 bg-white p-6 shadow-xl sm:p-8">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <Laptop className="size-6" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-teal-950">授权 IssueFlow 桌面设备</h1>
            <p className="text-sm text-slate-500">将 IssueFlow 桌面浮窗与您的账号绑定</p>
          </div>
        </div>

        {!codeParam && (
          <div className="mt-6 space-y-4">
            <FormField label="设备配对码" htmlFor="manualCode" hint="请输入桌面应用上显示的 8 位配对码（例如 ABCD-EF23）">
              <Input
                id="manualCode"
                placeholder="ABCD-EF23"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                className="font-mono text-center text-lg uppercase tracking-widest"
                maxLength={9}
              />
            </FormField>
          </div>
        )}

        {verifyQuery.isLoading && (
          <div className="mt-8 flex justify-center py-8">
            <Spinner label="正在验证配对码…" />
          </div>
        )}

        {verifyQuery.isError && (
          <div className="mt-6 space-y-4">
            <Alert
              message={
                verifyQuery.error instanceof Error
                  ? verifyQuery.error.message
                  : '配对码无效或已过期，请在桌面端重新发起授权'
              }
            />
            {codeParam && (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearchParams({});
                  setManualCode('');
                }}
                className="w-full"
              >
                手动输入其他配对码
              </Button>
            )}
          </div>
        )}

        {approveMutation.isError && (
          <div className="mt-6">
            <Alert
              message={
                approveMutation.error instanceof Error
                  ? approveMutation.error.message
                  : '批准授权失败，请稍后重试'
              }
            />
          </div>
        )}

        {verifyQuery.data && !isApproved && (
          <div className="mt-6 space-y-6">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-slate-500">申请设备</span>
                <span className="font-semibold text-slate-800">{verifyQuery.data.deviceName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">授权账号</span>
                <span className="font-semibold text-slate-800">
                  {user?.displayName} (@{user?.username})
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">配对码</span>
                <span className="font-mono font-medium text-teal-700">{activeCode}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">有效期限</span>
                <span className="text-slate-600">
                  {new Date(verifyQuery.data.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 前
                </span>
              </div>
            </div>

            <div className="flex items-start gap-2 text-xs text-slate-500">
              <ShieldCheck className="size-4 shrink-0 text-teal-600 mt-0.5" aria-hidden="true" />
              <span>批准后，该桌面设备将以您的当前账号身份访问 IssueFlow，您可随时在“设置 → API Token”中撤销该设备的授权。</span>
            </div>

            <div className="flex gap-3">
              <Button
                variant="primary"
                loading={approveMutation.isPending}
                onClick={() => approveMutation.mutate()}
                className="flex-1 bg-teal-600 hover:bg-teal-700"
              >
                确认批准授权
              </Button>
              <Link
                to="/issues"
                className="flex-1 inline-flex min-h-11 items-center justify-center rounded-lg border border-transparent bg-transparent px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
              >
                取消
              </Link>
            </div>
          </div>
        )}

        {isApproved && (
          <div className="mt-6 space-y-6 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-teal-100 text-teal-600">
              <CheckCircle2 className="size-8" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-slate-900">授权成功！</h2>
              <p className="text-sm text-slate-600">
                已成功授权设备 <span className="font-semibold text-slate-800">{verifyQuery.data?.deviceName || '桌面应用'}</span>。
              </p>
              <p className="text-sm text-teal-700">您可以返回桌面应用继续使用。</p>
            </div>

            <div className="pt-2">
              <Link
                to="/issues"
                className="inline-flex w-full min-h-11 items-center justify-center rounded-lg border border-brand-600 bg-white px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50 transition-colors"
              >
                返回 Issue 列表
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
