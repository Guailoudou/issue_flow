import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthFlow } from './AuthFlow';
import { tauriBridge } from '../../lib/tauri/bridge';

describe('AuthFlow', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(tauriBridge, 'getAppConfig').mockResolvedValue({
      serverUrl: 'http://localhost:3101',
      globalShortcut: 'Alt+CommandOrControl+I',
      launchAtLogin: false,
      pinned: false,
      edgeSnapEnabled: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows user to start pairing, displays code, and supports reopen/cancel', async () => {
    const startPairingSpy = vi.spyOn(tauriBridge, 'startPairing').mockResolvedValueOnce({
      pairingId: 'pairing-123',
      userCode: 'FLOW-8823',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      pollIntervalSeconds: 5,
    });
    const reopenSpy = vi.spyOn(tauriBridge, 'reopenPairingAuthorization').mockResolvedValue();
    const cancelSpy = vi.spyOn(tauriBridge, 'cancelPairing').mockResolvedValue();
    vi.spyOn(tauriBridge, 'pollPairingStatus').mockResolvedValue({
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      retryAfterSeconds: 5,
    });

    const user = userEvent.setup();
    const onAuth = vi.fn();

    render(<AuthFlow onAuthenticated={onAuth} />);

    expect(screen.getByText('IssueFlow 桌面浮窗')).toBeInTheDocument();
    expect(screen.getByLabelText('服务地址')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /浏览器授权登录/ }));

    expect(startPairingSpy).toHaveBeenCalledWith('http://localhost:3101', 'Mac 浮窗');
    expect(await screen.findByText('FLOW-8823')).toBeInTheDocument();
    expect(screen.getByText(/已在默认浏览器中打开授权页/)).toBeInTheDocument();

    // Click reopen
    await user.click(screen.getByRole('button', { name: '重新打开授权页面' }));
    expect(reopenSpy).toHaveBeenCalled();

    // Click cancel
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(cancelSpy).toHaveBeenCalledWith('pairing-123');
    expect(screen.getByLabelText('服务地址')).toBeInTheDocument();
  });

  it('polls sequentially using setTimeout, respects server retryAfterSeconds, and stops after AUTHORIZED', async () => {
    vi.useFakeTimers();

    vi.spyOn(tauriBridge, 'startPairing').mockResolvedValue({
      pairingId: 'pairing-123',
      userCode: 'FLOW-8823',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      pollIntervalSeconds: 3,
    });

    const pollSpy = vi.spyOn(tauriBridge, 'pollPairingStatus');
    pollSpy.mockResolvedValueOnce({
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      retryAfterSeconds: 6,
    });
    pollSpy.mockResolvedValueOnce({
      status: 'AUTHORIZED',
      apiToken: {
        id: 101,
        name: 'Desk Token',
        prefix: 'ift_desk',
        kind: 'DESKTOP',
        deviceName: 'Mac',
        expiresAt: null,
        createdAt: new Date().toISOString(),
      },
    });

    const onAuth = vi.fn();
    render(<AuthFlow onAuthenticated={onAuth} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /浏览器授权登录/ }));
    });

    expect(screen.getByText('FLOW-8823')).toBeInTheDocument();
    expect(pollSpy).not.toHaveBeenCalled();

    // Advance 3s for initial pollIntervalSeconds
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(pollSpy).toHaveBeenCalledTimes(1);

    // Advance 4s: retryAfter is 6s, so at 4s no new poll should have fired
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(pollSpy).toHaveBeenCalledTimes(1);

    // Advance another 2s: total 6s since first poll resolved -> second poll fires
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(pollSpy).toHaveBeenCalledTimes(2);
    expect(onAuth).toHaveBeenCalledTimes(1);

    // Advance further 30s: no more polling occurs after AUTHORIZED
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(pollSpy).toHaveBeenCalledTimes(2);
  });

  it('stops polling immediately when cancelled or unmounted', async () => {
    vi.useFakeTimers();

    vi.spyOn(tauriBridge, 'startPairing').mockResolvedValue({
      pairingId: 'pairing-123',
      userCode: 'FLOW-8823',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      pollIntervalSeconds: 3,
    });

    const pollSpy = vi.spyOn(tauriBridge, 'pollPairingStatus').mockResolvedValue({
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      retryAfterSeconds: 3,
    });

    vi.spyOn(tauriBridge, 'cancelPairing').mockResolvedValue();

    const onAuth = vi.fn();
    const { unmount } = render(<AuthFlow onAuthenticated={onAuth} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /浏览器授权登录/ }));
    });
    expect(screen.getByText('FLOW-8823')).toBeInTheDocument();

    // Unmount
    unmount();

    // Advance 20s: pollSpy should NEVER be called after unmount
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(pollSpy).not.toHaveBeenCalled();
  });

  it('handles transient network errors non-blockingly and continues polling', async () => {
    vi.useFakeTimers();

    vi.spyOn(tauriBridge, 'startPairing').mockResolvedValue({
      pairingId: 'pairing-123',
      userCode: 'FLOW-8823',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      pollIntervalSeconds: 2,
    });

    const pollSpy = vi.spyOn(tauriBridge, 'pollPairingStatus');
    pollSpy.mockRejectedValueOnce(new Error('Network error: connection refused'));
    pollSpy.mockResolvedValueOnce({
      status: 'AUTHORIZED',
      apiToken: {
        id: 101,
        name: 'Desk Token',
        prefix: 'ift_desk',
        kind: 'DESKTOP',
        deviceName: 'Mac',
        expiresAt: null,
        createdAt: new Date().toISOString(),
      },
    });

    const onAuth = vi.fn();
    render(<AuthFlow onAuthenticated={onAuth} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /浏览器授权登录/ }));
    });
    expect(screen.getByText('FLOW-8823')).toBeInTheDocument();

    // 1st poll fires at 2s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(pollSpy).toHaveBeenCalledTimes(1);

    // Shows transient warning
    expect(screen.getByText('网络连接暂不稳定，正在自动重试…')).toBeInTheDocument();

    // Next poll with backoff fires at 5s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(pollSpy).toHaveBeenCalledTimes(2);
    expect(onAuth).toHaveBeenCalledTimes(1);
  });

  it('stops polling and displays error message when PAIRING_CONFIG_SAVE_FAILED is returned', async () => {
    vi.useFakeTimers();

    vi.spyOn(tauriBridge, 'startPairing').mockResolvedValue({
      pairingId: 'pairing-123',
      userCode: 'FLOW-8823',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      pollIntervalSeconds: 2,
    });

    const pollSpy = vi.spyOn(tauriBridge, 'pollPairingStatus');
    pollSpy.mockRejectedValueOnce(
      new Error('PAIRING_CONFIG_SAVE_FAILED: Failed to update app configuration: Disk write failed'),
    );

    const onAuth = vi.fn();
    render(<AuthFlow onAuthenticated={onAuth} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /浏览器授权登录/ }));
    });

    expect(screen.getByText('FLOW-8823')).toBeInTheDocument();

    // Advance 2s to trigger poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(pollSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('保存连接配置失败，请重试')).toBeInTheDocument();
    expect(onAuth).not.toHaveBeenCalled();

    // Advance more time: polling has completely stopped
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(pollSpy).toHaveBeenCalledTimes(1);
  });

  it('discards late responses from cancelled or superseded sessions', async () => {
    vi.useFakeTimers();

    let resolveFirstPoll!: (value: any) => void;
    const pollSpy = vi.spyOn(tauriBridge, 'pollPairingStatus');

    // First startPairing call
    vi.spyOn(tauriBridge, 'startPairing')
      .mockResolvedValueOnce({
        pairingId: 'pairing-session-1',
        userCode: 'FLOW-1111',
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        pollIntervalSeconds: 1,
      })
      .mockResolvedValueOnce({
        pairingId: 'pairing-session-2',
        userCode: 'FLOW-2222',
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        pollIntervalSeconds: 1,
      });

    vi.spyOn(tauriBridge, 'cancelPairing').mockResolvedValue();

    const onAuth = vi.fn();
    render(<AuthFlow onAuthenticated={onAuth} />);

    // Start Session 1
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /浏览器授权登录/ }));
    });
    expect(screen.getByText('FLOW-1111')).toBeInTheDocument();

    // Poll for Session 1 becomes in-flight
    pollSpy.mockImplementationOnce(() => {
      return new Promise((resolve) => {
        resolveFirstPoll = resolve;
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(pollSpy).toHaveBeenCalledTimes(1);

    // Cancel Session 1
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
    });

    // Start Session 2
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /浏览器授权登录/ }));
    });
    expect(screen.getByText('FLOW-2222')).toBeInTheDocument();

    // Now Session 1's late in-flight poll resolves as AUTHORIZED
    await act(async () => {
      resolveFirstPoll({
        status: 'AUTHORIZED',
        apiToken: { id: 99, name: 'Old Token', prefix: 'ift', kind: 'DESKTOP', deviceName: 'Mac', expiresAt: null, createdAt: new Date().toISOString() },
      });
    });

    // onAuth must NOT have been called from Session 1
    expect(onAuth).not.toHaveBeenCalled();
  });

  it('stops polling and displays error message when PAIRING_TOKEN_SAVE_FAILED or PAIRING_STALE_SESSION is returned', async () => {
    vi.useFakeTimers();

    vi.spyOn(tauriBridge, 'startPairing').mockResolvedValue({
      pairingId: 'pairing-token-err',
      userCode: 'FLOW-9999',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      pollIntervalSeconds: 1,
    });

    const pollSpy = vi.spyOn(tauriBridge, 'pollPairingStatus');
    pollSpy.mockRejectedValueOnce(
      new Error('PAIRING_TOKEN_SAVE_FAILED: Keychain save error'),
    );

    const onAuth = vi.fn();
    render(<AuthFlow onAuthenticated={onAuth} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /浏览器授权登录/ }));
    });

    expect(screen.getByText('FLOW-9999')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(pollSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('保存认证凭据失败，请重试')).toBeInTheDocument();
    expect(onAuth).not.toHaveBeenCalled();

    // Advance time: polling does not continue
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(pollSpy).toHaveBeenCalledTimes(1);
  });

  it('stops polling and displays terminal error when PAIRING_COMMIT_FAILED_REVOKE_FAILED is returned', async () => {
    vi.useFakeTimers();

    vi.spyOn(tauriBridge, 'startPairing').mockResolvedValue({
      pairingId: 'pairing-revoke-err',
      userCode: 'FLOW-7777',
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      pollIntervalSeconds: 1,
    });

    const pollSpy = vi.spyOn(tauriBridge, 'pollPairingStatus');
    pollSpy.mockRejectedValueOnce(
      new Error(
        'PAIRING_COMMIT_FAILED_REVOKE_FAILED: PAIRING_CONFIG_SAVE_FAILED: Disk write failed; Additionally, token self-revocation failed: Network error. Please revoke this device token manually in web UI or settings.',
      ),
    );

    const onAuth = vi.fn();
    render(<AuthFlow onAuthenticated={onAuth} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /浏览器授权登录/ }));
    });

    expect(screen.getByText('FLOW-7777')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(pollSpy).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/本地配对提交失败且服务端凭据撤销失败，请前往 Web 端手动撤销该设备 Token/),
    ).toBeInTheDocument();
    expect(onAuth).not.toHaveBeenCalled();

    // Advance time: polling has stopped permanently (terminal)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(pollSpy).toHaveBeenCalledTimes(1);
  });
});
