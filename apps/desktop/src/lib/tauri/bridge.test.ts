import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('tauriBridge unauthenticated event triggering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  });

  it('triggers onUnauthenticated exactly once when an invoke fails with UNAUTHENTICATED', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { tauriBridge, onUnauthenticated } = await import('./bridge');

    const unauthListener = vi.fn();
    const unsubscribe = onUnauthenticated(unauthListener);

    vi.mocked(invoke).mockRejectedValueOnce('UNAUTHENTICATED');

    await expect(tauriBridge.getOverview()).rejects.toEqual('UNAUTHENTICATED');

    expect(unauthListener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('does not trigger onUnauthenticated when an invoke fails with a generic network error', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { tauriBridge, onUnauthenticated } = await import('./bridge');

    const unauthListener = vi.fn();
    const unsubscribe = onUnauthenticated(unauthListener);

    vi.mocked(invoke).mockRejectedValueOnce(new Error('Network offline'));

    await expect(tauriBridge.getOverview()).rejects.toThrow('Network offline');

    expect(unauthListener).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('does not double trigger on other bridge methods', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { tauriBridge, onUnauthenticated } = await import('./bridge');

    const unauthListener = vi.fn();
    const unsubscribe = onUnauthenticated(unauthListener);

    vi.mocked(invoke).mockRejectedValueOnce('UNAUTHENTICATED');

    await expect(
      tauriBridge.updateIssueState(1, 'CLOSED', new Date().toISOString()),
    ).rejects.toEqual('UNAUTHENTICATED');

    expect(unauthListener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('passes canonical origin to onUnauthenticated listener when error includes origin', async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const { tauriBridge, onUnauthenticated } = await import('./bridge');

    const unauthListener = vi.fn();
    const unsubscribe = onUnauthenticated(unauthListener);

    vi.mocked(invoke).mockRejectedValueOnce('UNAUTHENTICATED:https://server-a.example.com');

    await expect(tauriBridge.getOverview()).rejects.toEqual(
      'UNAUTHENTICATED:https://server-a.example.com',
    );

    expect(unauthListener).toHaveBeenCalledWith({
      origin: 'https://server-a.example.com',
    });

    unsubscribe();
  });
});
