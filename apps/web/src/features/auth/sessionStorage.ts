import type { QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import type { User } from '../../lib/types';

export const AUTH_USER_STORAGE_KEY = 'issueflow.auth.user.v1';
export const SESSION_QUERY_KEY = ['session'] as const;

const cachedUserSchema = z.object({
  id: z.number().int().positive(),
  username: z.string().trim().min(1),
  displayName: z.string().trim().min(1),
  email: z.string().nullable().optional(),
  role: z.enum(['ADMIN', 'USER']),
  roles: z.array(z.enum(['MANAGEMENT', 'DEVELOPMENT', 'PRODUCT'])).optional(),
  active: z.boolean(),
  avatarUrl: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
}).strict();

type CachedUser = z.infer<typeof cachedUserSchema>;

function normalizeUser(value: CachedUser): User {
  return {
    id: value.id,
    username: value.username,
    displayName: value.displayName,
    ...(value.email ? { email: value.email } : {}),
    role: value.role,
    ...(value.roles ? { roles: value.roles } : {}),
    active: value.active,
    ...(value.avatarUrl ? { avatarUrl: value.avatarUrl } : {}),
    ...(value.createdAt ? { createdAt: value.createdAt } : {}),
    ...(value.updatedAt ? { updatedAt: value.updatedAt } : {}),
  };
}

export function parseSessionUser(value: unknown): User | null {
  const result = cachedUserSchema.safeParse(value);
  return result.success ? normalizeUser(result.data) : null;
}

export function clearCachedUser() {
  try {
    window.localStorage.removeItem(AUTH_USER_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in privacy mode; authentication still uses the cookie.
  }
}

export function readCachedUser(): User | null {
  try {
    const raw = window.localStorage.getItem(AUTH_USER_STORAGE_KEY);
    if (!raw) return null;
    const user = parseSessionUser(JSON.parse(raw));
    if (!user) clearCachedUser();
    return user;
  } catch {
    clearCachedUser();
    return null;
  }
}

export function writeCachedUser(value: unknown): User | null {
  const user = parseSessionUser(value);
  if (!user) {
    clearCachedUser();
    return null;
  }
  try {
    window.localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
  } catch {
    // The in-memory session remains usable when persistent storage is unavailable.
  }
  return user;
}

export function setSessionUser(queryClient: QueryClient, value: unknown): User | null {
  const user = writeCachedUser(value);
  queryClient.setQueryData(SESSION_QUERY_KEY, user);
  return user;
}

export function clearSessionUser(queryClient: QueryClient) {
  clearCachedUser();
  queryClient.clear();
  queryClient.setQueryData(SESSION_QUERY_KEY, null);
}
