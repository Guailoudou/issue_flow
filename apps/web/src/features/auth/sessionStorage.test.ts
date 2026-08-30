import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import { AUTH_USER_STORAGE_KEY, clearSessionUser, readCachedUser, setSessionUser } from './sessionStorage';

const user = { id: 1, username: 'admin', displayName: '管理员', role: 'ADMIN', active: true } as const;

describe('会话快照存储', () => {
  beforeEach(() => window.localStorage.clear());

  it('登录同步时只保存经过校验的用户字段', () => {
    const client = new QueryClient();
    setSessionUser(client, { ...user, password: 'secret', token: 'token' });

    expect(window.localStorage.getItem(AUTH_USER_STORAGE_KEY)).toBeNull();
    expect(client.getQueryData(['session'])).toBeNull();

    setSessionUser(client, user);
    expect(readCachedUser()).toEqual(user);
  });

  it('登出时同时清除本地快照和查询缓存', () => {
    const client = new QueryClient();
    setSessionUser(client, user);
    client.setQueryData(['issues'], [{ id: 3 }]);

    clearSessionUser(client);

    expect(window.localStorage.getItem(AUTH_USER_STORAGE_KEY)).toBeNull();
    expect(client.getQueryData(['session'])).toBeNull();
    expect(client.getQueryData(['issues'])).toBeUndefined();
  });
});
