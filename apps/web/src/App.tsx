import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminShell } from './components/organisms/AdminShell';
import { AppShell } from './components/organisms/AppShell';
import { RequireAdmin, RequireAuth } from './features/auth/RouteGuards';

const lazyPage = <T extends Record<string, unknown>, K extends keyof T>(
  loader: () => Promise<T>,
  name: K,
) => lazy(async () => ({ default: (await loader())[name] as ComponentType }));

const IssueDetailPage = lazyPage(() => import('./pages/IssueDetailPage'), 'IssueDetailPage');
const IssueListPage = lazyPage(() => import('./pages/IssueListPage'), 'IssueListPage');
const LoginPage = lazyPage(() => import('./pages/LoginPage'), 'LoginPage');
const RegisterPage = lazyPage(() => import('./pages/RegisterPage'), 'RegisterPage');
const NewIssuePage = lazyPage(() => import('./pages/NewIssuePage'), 'NewIssuePage');
const NotificationsPage = lazyPage(() => import('./pages/NotificationsPage'), 'NotificationsPage');
const ApiTokensPage = lazyPage(() => import('./pages/ApiTokensPage'), 'ApiTokensPage');
const ProfilePage = lazyPage(() => import('./pages/ProfilePage'), 'ProfilePage');
const ForbiddenPage = lazyPage(() => import('./pages/StatePages'), 'ForbiddenPage');
const NotFoundPage = lazyPage(() => import('./pages/StatePages'), 'NotFoundPage');
const AdminDashboardPage = lazyPage(() => import('./pages/admin/AdminDashboardPage'), 'AdminDashboardPage');
const AdminLabelsPage = lazyPage(() => import('./pages/admin/AdminLabelsPage'), 'AdminLabelsPage');
const AdminMilestonesPage = lazyPage(() => import('./pages/admin/AdminMilestonesPage'), 'AdminMilestonesPage');
const AdminSettingsPage = lazyPage(() => import('./pages/admin/AdminSettingsPage'), 'AdminSettingsPage');
const AdminUsersPage = lazyPage(() => import('./pages/admin/AdminUsersPage'), 'AdminUsersPage');
const AdminYunxiaoPage = lazyPage(() => import('./pages/admin/AdminYunxiaoPage'), 'AdminYunxiaoPage');

function RouteLoading() {
  return <div className="flex min-h-48 items-center justify-center text-sm text-slate-600" role="status">正在加载页面…</div>;
}

export function App() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/issues" replace />} />
            <Route path="issues" element={<IssueListPage />} />
            <Route path="issues/new" element={<NewIssuePage />} />
            <Route path="issues/:number" element={<IssueDetailPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="settings/api-tokens" element={<ApiTokensPage />} />
            <Route path="settings/profile" element={<ProfilePage />} />
            <Route path="403" element={<ForbiddenPage />} />
            <Route element={<RequireAdmin />}>
              <Route path="admin" element={<AdminShell />}>
                <Route index element={<AdminDashboardPage />} />
                <Route path="users" element={<AdminUsersPage />} />
                <Route path="labels" element={<AdminLabelsPage />} />
                <Route path="milestones" element={<AdminMilestonesPage />} />
                <Route path="yunxiao" element={<AdminYunxiaoPage />} />
                <Route path="settings" element={<AdminSettingsPage />} />
              </Route>
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
