import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';
import { tauriBridge } from '../../lib/tauri/bridge';

describe('SettingsPage', () => {
  it('renders settings and updates preferences', async () => {
    vi.spyOn(tauriBridge, 'getDesktopPreferences').mockResolvedValue({
      systemNotificationsEnabled: true,
      assignmentNotificationsEnabled: true,
      mentionNotificationsEnabled: true,
      statusNotificationsEnabled: true,
      assigneeNotificationsEnabled: true,
      commentNotificationsEnabled: false,
      doNotDisturbEnabled: false,
      doNotDisturbStart: '22:00',
      doNotDisturbEnd: '08:00',
      timeZone: 'Asia/Shanghai',
      recentlyClosedDays: 7,
      updatedAt: new Date().toISOString(),
    });

    vi.spyOn(tauriBridge, 'getAppConfig').mockResolvedValue({
      serverUrl: 'http://localhost:3101',
      globalShortcut: 'Alt+CommandOrControl+I',
      launchAtLogin: false,
      pinned: false,
      edgeSnapEnabled: true,
    });

    const updatePrefSpy = vi
      .spyOn(tauriBridge, 'updateDesktopPreferences')
      .mockResolvedValue({} as never);
    const updateCfgSpy = vi
      .spyOn(tauriBridge, 'updateAppConfig')
      .mockResolvedValue({} as never);

    const user = userEvent.setup();
    const onBack = vi.fn();
    const onLogout = vi.fn();
    const onSaved = vi.fn();

    render(
      <SettingsPage
        onBack={onBack}
        onLogout={onLogout}
        onSaved={onSaved}
        currentUser={{
          id: 1,
          username: 'alex',
          displayName: 'Alex Chen',
          email: 'alex@example.com',
          role: 'USER',
          roles: ['DEVELOPMENT'],
          active: true,
          createdAt: '',
          updatedAt: '',
        }}
      />,
    );

    expect(await screen.findByText('Alex Chen')).toBeInTheDocument();
    expect(screen.getByText('@alex')).toBeInTheDocument();
    expect(screen.getByText('启用 macOS 系统通知')).toBeInTheDocument();

    const shortcutRecorder = screen.getByRole('button', { name: '呼出快捷键' });
    expect(shortcutRecorder).toHaveTextContent('⌥⌘I');

    await user.click(shortcutRecorder);
    await user.keyboard('{Meta>}{Shift>}k{/Shift}{/Meta}');

    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(updatePrefSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        timeZone: expect.any(String),
      }),
    );
    expect(updateCfgSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        globalShortcut: 'CommandOrControl+Shift+K',
      }),
    );
    expect(onSaved).toHaveBeenCalled();
    expect(await screen.findByText('设置已成功保存')).toBeInTheDocument();
  });

  it('stops saving and displays server preference error without updating app config', async () => {
    vi.spyOn(tauriBridge, 'getDesktopPreferences').mockResolvedValue({
      systemNotificationsEnabled: true,
      assignmentNotificationsEnabled: true,
      mentionNotificationsEnabled: true,
      statusNotificationsEnabled: true,
      assigneeNotificationsEnabled: true,
      commentNotificationsEnabled: false,
      doNotDisturbEnabled: false,
      doNotDisturbStart: '22:00',
      doNotDisturbEnd: '08:00',
      timeZone: 'Asia/Shanghai',
      recentlyClosedDays: 7,
      updatedAt: new Date().toISOString(),
    });

    vi.spyOn(tauriBridge, 'getAppConfig').mockResolvedValue({
      serverUrl: 'http://localhost:3101',
      globalShortcut: 'Alt+CommandOrControl+I',
      launchAtLogin: false,
      pinned: false,
      edgeSnapEnabled: true,
    });

    vi.spyOn(tauriBridge, 'updateDesktopPreferences').mockRejectedValue(
      new Error('500 Server Error'),
    );
    const updateCfgSpy = vi.spyOn(tauriBridge, 'updateAppConfig');

    const user = userEvent.setup();

    render(
      <SettingsPage
        onBack={vi.fn()}
        onLogout={vi.fn()}
        currentUser={null}
      />,
    );

    expect(await screen.findByText('启用 macOS 系统通知')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText(/服务端偏好保存失败: 500 Server Error/)).toBeInTheDocument();
    expect(updateCfgSpy).not.toHaveBeenCalled();
  });

  it('displays explicit message when server succeeds and local app config save fails', async () => {
    vi.spyOn(tauriBridge, 'getDesktopPreferences').mockResolvedValue({
      systemNotificationsEnabled: true,
      assignmentNotificationsEnabled: true,
      mentionNotificationsEnabled: true,
      statusNotificationsEnabled: true,
      assigneeNotificationsEnabled: true,
      commentNotificationsEnabled: false,
      doNotDisturbEnabled: false,
      doNotDisturbStart: '22:00',
      doNotDisturbEnd: '08:00',
      timeZone: 'Asia/Shanghai',
      recentlyClosedDays: 7,
      updatedAt: new Date().toISOString(),
    });

    vi.spyOn(tauriBridge, 'getAppConfig').mockResolvedValue({
      serverUrl: 'http://localhost:3101',
      globalShortcut: 'Alt+CommandOrControl+I',
      launchAtLogin: false,
      pinned: false,
      edgeSnapEnabled: true,
    });

    vi.spyOn(tauriBridge, 'updateDesktopPreferences').mockResolvedValue({} as never);
    vi.spyOn(tauriBridge, 'updateAppConfig').mockRejectedValue(
      new Error('Failed to register shortcut: Hotkey conflict'),
    );

    const user = userEvent.setup();

    render(
      <SettingsPage
        onBack={vi.fn()}
        onLogout={vi.fn()}
        currentUser={null}
      />,
    );

    expect(await screen.findByText('启用 macOS 系统通知')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(
      await screen.findByText(
        /服务端偏好已保存，本地应用设置保存失败: Failed to register shortcut: Hotkey conflict/,
      ),
    ).toBeInTheDocument();
  });

  it('prompts confirmation when serverUrl is modified and aborts if user cancels', async () => {
    vi.spyOn(tauriBridge, 'getDesktopPreferences').mockResolvedValue({
      systemNotificationsEnabled: true,
      assignmentNotificationsEnabled: true,
      mentionNotificationsEnabled: true,
      statusNotificationsEnabled: true,
      assigneeNotificationsEnabled: true,
      commentNotificationsEnabled: false,
      doNotDisturbEnabled: false,
      doNotDisturbStart: '22:00',
      doNotDisturbEnd: '08:00',
      timeZone: 'Asia/Shanghai',
      recentlyClosedDays: 7,
      updatedAt: new Date().toISOString(),
    });

    vi.spyOn(tauriBridge, 'getAppConfig').mockResolvedValue({
      serverUrl: 'http://localhost:3101',
      globalShortcut: 'Alt+CommandOrControl+I',
      launchAtLogin: false,
      pinned: false,
      edgeSnapEnabled: true,
    });

    const updateCfgSpy = vi.spyOn(tauriBridge, 'updateAppConfig');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false); // User cancels

    const user = userEvent.setup();

    render(
      <SettingsPage
        onBack={vi.fn()}
        onLogout={vi.fn()}
        currentUser={null}
      />,
    );

    const urlInput = await screen.findByLabelText('服务连接地址');
    await user.clear(urlInput);
    await user.type(urlInput, 'https://new-server.example.com');

    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('修改服务地址将断开当前实时连接'),
    );
    expect(updateCfgSpy).not.toHaveBeenCalled();
  });

  it('displays error and does not call onLogout if logout command fails', async () => {
    vi.spyOn(tauriBridge, 'getDesktopPreferences').mockResolvedValue({} as never);
    vi.spyOn(tauriBridge, 'getAppConfig').mockResolvedValue({
      serverUrl: 'http://localhost:3101',
      globalShortcut: 'Alt+CommandOrControl+I',
      launchAtLogin: false,
      pinned: false,
      edgeSnapEnabled: true,
    });

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(tauriBridge, 'logout').mockRejectedValue(new Error('Keychain access denied'));

    const onLogout = vi.fn();
    const user = userEvent.setup();

    render(
      <SettingsPage
        onBack={vi.fn()}
        onLogout={onLogout}
        currentUser={{
          id: 1,
          username: 'alex',
          displayName: 'Alex Chen',
          email: 'alex@example.com',
          role: 'USER',
          roles: [],
          active: true,
          createdAt: '',
          updatedAt: '',
        }}
      />,
    );

    const logoutBtn = await screen.findByRole('button', { name: /退出登录/ });
    await user.click(logoutBtn);

    expect(onLogout).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/退出登录失败（未能安全删除本地凭据）: Keychain access denied/),
    ).toBeInTheDocument();
  });

  it('invokes tauriBridge.logout exactly once on single click and calls onLogout upon success', async () => {
    vi.spyOn(tauriBridge, 'getDesktopPreferences').mockResolvedValue({} as never);
    vi.spyOn(tauriBridge, 'getAppConfig').mockResolvedValue({
      serverUrl: 'http://localhost:3101',
      globalShortcut: 'Alt+CommandOrControl+I',
      launchAtLogin: false,
      pinned: false,
      edgeSnapEnabled: true,
    });

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const logoutSpy = vi.spyOn(tauriBridge, 'logout').mockResolvedValue();

    const onLogout = vi.fn();
    const user = userEvent.setup();

    render(
      <SettingsPage
        onBack={vi.fn()}
        onLogout={onLogout}
        currentUser={{
          id: 1,
          username: 'alex',
          displayName: 'Alex Chen',
          email: 'alex@example.com',
          role: 'USER',
          roles: [],
          active: true,
          createdAt: '',
          updatedAt: '',
        }}
      />,
    );

    const logoutBtn = await screen.findByRole('button', { name: /退出登录/ });
    await user.click(logoutBtn);

    expect(logoutSpy).toHaveBeenCalledTimes(1);
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});

