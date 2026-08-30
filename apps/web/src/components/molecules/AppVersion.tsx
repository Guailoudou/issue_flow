import { PackageCheck } from 'lucide-react';

export const appVersion = {
  version: __ISSUEFLOW_VERSION__,
  buildId: __ISSUEFLOW_BUILD_ID__,
  builtAt: __ISSUEFLOW_BUILT_AT__,
} as const;

export interface BackendVersion { version: string; buildId: string; builtAt: string }

function formatBuiltAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date);
}

export function AppVersion({ backend, backendLoading = false, backendError = false }: { backend?: BackendVersion; backendLoading?: boolean; backendError?: boolean }) {
  return <section className="surface mb-5 p-4" aria-labelledby="app-version-title">
    <div className="mb-3 flex min-w-0 items-center gap-3">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><PackageCheck className="size-5" aria-hidden="true" /></span>
      <div className="min-w-0"><h2 id="app-version-title" className="text-sm font-semibold text-slate-900">当前部署版本</h2><p className="mt-0.5 text-sm text-slate-600">用于确认浏览器和 API 是否都已加载最新构建</p></div>
    </div>
    <div className="grid gap-3 md:grid-cols-2">
      <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-1 rounded-lg border bg-slate-50 p-3 text-sm"><div className="col-span-2 mb-1 font-semibold text-slate-800">前端</div><div><dt className="text-xs text-slate-500">版本</dt><dd className="font-mono font-semibold text-slate-900">v{appVersion.version}</dd></div><div><dt className="text-xs text-slate-500">构建标识</dt><dd className="break-words font-mono font-semibold text-slate-900">{appVersion.buildId}</dd></div><div className="col-span-2"><dt className="sr-only">前端构建时间</dt><dd className="text-xs text-slate-500">构建于 {formatBuiltAt(appVersion.builtAt)}</dd></div></dl>
      <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-1 rounded-lg border bg-slate-50 p-3 text-sm"><div className="col-span-2 mb-1 font-semibold text-slate-800">后端</div>{backendLoading ? <div className="col-span-2 text-sm text-slate-500" role="status">正在读取后端版本…</div> : backendError || !backend ? <div className="col-span-2 text-sm text-red-700">后端版本读取失败</div> : <><div><dt className="text-xs text-slate-500">版本</dt><dd className="font-mono font-semibold text-slate-900">v{backend.version}</dd></div><div><dt className="text-xs text-slate-500">构建标识</dt><dd className="break-words font-mono font-semibold text-slate-900">{backend.buildId}</dd></div><div className="col-span-2"><dt className="sr-only">后端构建时间</dt><dd className="text-xs text-slate-500">构建于 {formatBuiltAt(backend.builtAt)}</dd></div></>}</dl>
    </div>
  </section>;
}
