import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from '../../components/atoms/Spinner';
import { useAuth } from './AuthProvider';
export function RequireAuth() { const { user, loading } = useAuth(); const location = useLocation(); if (loading) return <Spinner label="正在验证会话" />; return user ? <Outlet /> : <Navigate to="/login" replace state={{ from: location }} />; }
export function RequireAdmin() { const { user } = useAuth(); return user?.role === 'ADMIN' ? <Outlet /> : <Navigate to="/403" replace />; }
