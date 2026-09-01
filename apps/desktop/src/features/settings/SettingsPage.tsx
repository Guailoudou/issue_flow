import {
  Bell,
  ChevronLeft,
  Clock,
  Globe,
  Laptop,
  LogOut,
  Moon,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { Switch } from '../../components/Switch';
import { tauriBridge } from '../../lib/tauri/bridge';
import type {
  AppConfig,
  DesktopPreferenceData,
  PublicUserInfo,
  RealtimeStatus,
} from '../../lib/types';

export interface SettingsPageProps {
  onBack: () => void;
  onLogout: () => void;
  onSaved?: (newConfig: AppConfig) => void;
  currentUser: PublicUserInfo | null;
  realtimeStatus?: RealtimeStatus;
}

export function SettingsPage({
  onBack,
  onLogout,
  onSaved,
  currentUser,
  realtimeStatus = 'connected',
}: SettingsPageProps) {
  const [preferences, setPreferences] = useState<DesktopPreferenceData | null>(null);
  const [preferencesLoadError, setPreferencesLoadError] = useState<string | null>(null);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isOffline = realtimeStatus !== 'connected';
  const originalServerUrlRef = useRef<string | null>(null);

  useEffect(() => {
    // Load local config
    tauriBridge
      .getAppConfig()
      .then((cfg) => {
        setAppConfig(cfg);
        if (originalServerUrlRef.current === null) {
          originalServerUrlRef.current = cfg.serverUrl;
        }
      })
      .catch((err) => {
        setSaveError(`读取应用配置失败: ${err instanceof Error ? err.message : String(err)}`);
      });

    // Load server preferences
    tauriBridge
      .getDesktopPreferences()
      .then((prefs) => {
        setPreferences(prefs);
        setPreferencesLoadError(null);
      })
      .catch((err) => {
        setPreferencesLoadError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  const handleSave = async () => {
    if (!appConfig) return;
    setIsSaving(true);
    setSaveSuccessNotice(null);
    setSaveError(null);

    // If online but preferences failed to load, forbid claiming complete success
    if (!isOffline && !preferences) {
      setSaveError(
        `服务端偏好设置未加载成功 (${preferencesLoadError || '网络错误'})，无法保存完整配置`,
      );
      setIsSaving(false);
      return;
    }

    if (
      originalServerUrlRef.current &&
      appConfig.serverUrl !== originalServerUrlRef.current
    ) {
      const ok = window.confirm(
        '修改服务地址将断开当前实时连接并重新连接。是否继续？',
      );
      if (!ok) {
        setIsSaving(false);
        return;
      }
    }

    let serverSaved = false;

    // 1. Save server preferences first if online and available
    if (preferences && !isOffline) {
      try {
        const savedPrefs = await tauriBridge.updateDesktopPreferences({
          systemNotificationsEnabled: preferences.systemNotificationsEnabled,
          assignmentNotificationsEnabled: preferences.assignmentNotificationsEnabled,
          mentionNotificationsEnabled: preferences.mentionNotificationsEnabled,
          statusNotificationsEnabled: preferences.statusNotificationsEnabled,
          assigneeNotificationsEnabled: preferences.assigneeNotificationsEnabled,
          commentNotificationsEnabled: preferences.commentNotificationsEnabled,
          doNotDisturbEnabled: preferences.doNotDisturbEnabled,
          doNotDisturbStart: preferences.doNotDisturbStart,
          doNotDisturbEnd: preferences.doNotDisturbEnd,
          timeZone: preferences.timeZone || 'Asia/Shanghai',
          recentlyClosedDays: preferences.recentlyClosedDays,
        });
        setPreferences(savedPrefs);
        serverSaved = true;
      } catch (err) {
        setSaveError(
          `服务端偏好保存失败: ${err instanceof Error ? err.message : String(err)}`,
        );
        setIsSaving(false);
        return;
      }
    }

    // 2. Save device app config
    try {
      const updated = await tauriBridge.updateAppConfig(appConfig);
      setAppConfig(updated);
      originalServerUrlRef.current = updated.serverUrl;
      onSaved?.(updated);

      if (isOffline) {
        setSaveSuccessNotice('已保存本地桌面配置。服务端偏好需联网后同步。');
      } else {
        setSaveSuccessNotice('设置已成功保存');
      }
      setTimeout(() => setSaveSuccessNotice(null), 3000);
    } catch (err) {
      if (serverSaved) {
        setSaveError(
          `服务端偏好已保存，本地应用设置保存失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      } else {
        setSaveError(
          `桌面应用设置保存失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogoutClick = async () => {
    if (
      window.confirm(
        '确定要退出当前账号吗？已保存的桌面 Token 将从 Keychain 中安全删除。',
      )
    ) {
      try {
        await tauriBridge.logout();
        onLogout();
      } catch (err) {
        setSaveError(
          `退出登录失败（未能安全删除本地凭据）: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  };

  return (
    <div className="flex h-screen w-full flex-col bg-slate-50 text-slate-900 select-none overflow-hidden">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 select-none">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 px-2 py-1 rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          aria-label="返回 (Esc)"
        >
          <ChevronLeft className="size-4" />
          <span>返回 (Esc)</span>
        </button>

        <h1 className="text-xs font-bold text-slate-800">偏好设置</h1>

        <Button
          size="sm"
          variant="teal"
          loading={isSaving}
          onClick={handleSave}
          icon={<Save className="size-3" />}
        >
          保存
        </Button>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
        {saveSuccessNotice && (
          <div
            role="status"
            className="rounded-lg bg-teal-50 border border-teal-200 p-2 text-teal-800 text-center font-medium"
          >
            {saveSuccessNotice}
          </div>
        )}

        {saveError && (
          <div
            role="alert"
            className="rounded-lg bg-rose-50 border border-rose-200 p-2 text-rose-700 flex justify-between items-center"
          >
            <span>{saveError}</span>
            <button
              type="button"
              aria-label="关闭提示"
              onClick={() => setSaveError(null)}
              className="text-rose-500 font-bold ml-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
            >
              ×
            </button>
          </div>
        )}

        {/* Account Info Card */}
        <section className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-teal-600" />
              <span className="font-semibold text-slate-800">当前已授权账号</span>
            </div>
            <button
              type="button"
              onClick={handleLogoutClick}
              className="flex items-center gap-1 text-red-600 hover:text-red-700 hover:underline font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-1"
            >
              <LogOut className="size-3" />
              <span>退出登录</span>
            </button>
          </div>

          <div className="rounded-lg bg-slate-50 p-2.5 flex justify-between items-center text-slate-600">
            <div>
              <p className="font-semibold text-slate-800">
                {currentUser?.displayName || 'IssueFlow 用户'}
              </p>
              <p className="text-[11px] text-slate-400">
                @{currentUser?.username || 'user'}
              </p>
            </div>
            <span className="text-[10px] bg-teal-100/70 text-teal-800 font-medium px-2 py-0.5 rounded">
              macOS Keychain 已保护
            </span>
          </div>
        </section>

        {/* Notification Settings */}
        {isOffline ? (
          <section className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2 text-slate-500">
            <div className="flex items-center gap-2 text-slate-700 font-semibold">
              <Bell className="size-4 text-amber-500" />
              <span>服务端通知偏好（当前离线只读）</span>
            </div>
            <p className="text-[11px] text-slate-400">
              当前处于离线状态，服务端偏好暂无法读取或同步。您仍可配置下方的桌面应用设置。
            </p>
          </section>
        ) : preferences ? (
          <section className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3">
            <div className="flex items-center gap-2 text-slate-800 font-semibold border-b border-slate-100 pb-2">
              <Bell className="size-4 text-teal-600" />
              <span>系统提醒与通知</span>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-700">启用 macOS 系统通知</p>
                  <p className="text-[11px] text-slate-400">
                    接收指派与关注 Issue 的变动通知
                  </p>
                </div>
                <Switch
                  checked={preferences.systemNotificationsEnabled}
                  onChange={(val) =>
                    setPreferences(
                      (prev) => prev && { ...prev, systemNotificationsEnabled: val },
                    )
                  }
                  aria-label="启用系统通知"
                />
              </div>

              {preferences.systemNotificationsEnabled && (
                <div className="pl-3 border-l-2 border-slate-100 space-y-2.5 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">新指派给我时提醒</span>
                    <Switch
                      checked={preferences.assignmentNotificationsEnabled}
                      onChange={(val) =>
                        setPreferences(
                          (prev) =>
                            prev && { ...prev, assignmentNotificationsEnabled: val },
                        )
                      }
                      aria-label="新指派提醒"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">评论中提及 (@我) 时提醒</span>
                    <Switch
                      checked={preferences.mentionNotificationsEnabled}
                      onChange={(val) =>
                        setPreferences(
                          (prev) =>
                            prev && { ...prev, mentionNotificationsEnabled: val },
                        )
                      }
                      aria-label="提及提醒"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">关注的 Issue 状态变化时提醒</span>
                    <Switch
                      checked={preferences.statusNotificationsEnabled}
                      onChange={(val) =>
                        setPreferences(
                          (prev) =>
                            prev && { ...prev, statusNotificationsEnabled: val },
                        )
                      }
                      aria-label="状态变化提醒"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">关注的 Issue 负责人变化时提醒</span>
                    <Switch
                      checked={preferences.assigneeNotificationsEnabled}
                      onChange={(val) =>
                        setPreferences(
                          (prev) =>
                            prev && { ...prev, assigneeNotificationsEnabled: val },
                        )
                      }
                      aria-label="负责人变化提醒"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">
                      普通评论提醒 (默认关闭以防打扰)
                    </span>
                    <Switch
                      checked={preferences.commentNotificationsEnabled}
                      onChange={(val) =>
                        setPreferences(
                          (prev) =>
                            prev && { ...prev, commentNotificationsEnabled: val },
                        )
                      }
                      aria-label="普通评论提醒"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Do Not Disturb & Timezone */}
            <div className="pt-2 border-t border-slate-100 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Moon className="size-3.5 text-slate-500" />
                  <span className="font-medium text-slate-700">免打扰模式</span>
                </div>
                <Switch
                  checked={preferences.doNotDisturbEnabled}
                  onChange={(val) =>
                    setPreferences(
                      (prev) => prev && { ...prev, doNotDisturbEnabled: val },
                    )
                  }
                  aria-label="免打扰模式"
                />
              </div>

              {preferences.doNotDisturbEnabled && (
                <div className="space-y-2 bg-slate-50 p-2.5 rounded-lg">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">免打扰时段：</span>
                    <input
                      type="time"
                      value={preferences.doNotDisturbStart || '22:00'}
                      onChange={(e) =>
                        setPreferences(
                          (prev) =>
                            prev && { ...prev, doNotDisturbStart: e.target.value },
                        )
                      }
                      className="border border-slate-200 bg-white rounded px-2 py-0.5 text-xs font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    />
                    <span className="text-slate-400">至</span>
                    <input
                      type="time"
                      value={preferences.doNotDisturbEnd || '08:00'}
                      onChange={(e) =>
                        setPreferences(
                          (prev) =>
                            prev && { ...prev, doNotDisturbEnd: e.target.value },
                        )
                      }
                      className="border border-slate-200 bg-white rounded px-2 py-0.5 text-xs font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-200/60">
                    <div className="flex items-center gap-1 text-slate-600">
                      <Globe className="size-3 text-slate-400" />
                      <label htmlFor="timeZoneInput" className="text-[11px]">
                        IANA 时区
                      </label>
                    </div>
                    <input
                      id="timeZoneInput"
                      type="text"
                      value={preferences.timeZone || 'Asia/Shanghai'}
                      onChange={(e) =>
                        setPreferences(
                          (prev) =>
                            prev && { ...prev, timeZone: e.target.value },
                        )
                      }
                      placeholder="Asia/Shanghai"
                      className="w-36 border border-slate-200 bg-white rounded px-2 py-0.5 text-xs font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    />
                  </div>
                </div>
              )}
            </div>
          </section>
        ) : preferencesLoadError ? (
          <section className="rounded-xl border border-rose-200 bg-rose-50/50 p-3.5 space-y-2">
            <div className="flex items-center gap-2 text-rose-700 font-semibold">
              <Bell className="size-4 text-rose-600" />
              <span>服务端通知偏好加载失败</span>
            </div>
            <p className="text-[11px] text-rose-600">{preferencesLoadError}</p>
          </section>
        ) : null}

        {/* Overview Display Preferences */}
        {preferences && (
          <section className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3">
            <div className="flex items-center gap-2 text-slate-800 font-semibold border-b border-slate-100 pb-2">
              <Clock className="size-4 text-teal-600" />
              <span>视图与列表过滤</span>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-slate-700">“最近关闭” 展示范围</p>
                <p className="text-[11px] text-slate-400">显示最近多少天内关闭的 Issue</p>
              </div>
              <select
                value={preferences.recentlyClosedDays}
                onChange={(e) =>
                  setPreferences(
                    (prev) =>
                      prev && {
                        ...prev,
                        recentlyClosedDays: Number(e.target.value) as 3 | 7 | 14 | 30,
                      },
                  )
                }
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <option value={3}>最近 3 天</option>
                <option value={7}>最近 7 天 (推荐)</option>
                <option value={14}>最近 14 天</option>
                <option value={30}>最近 30 天</option>
              </select>
            </div>
          </section>
        )}

        {/* App & Device Settings */}
        {appConfig && (
          <section className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3">
            <div className="flex items-center gap-2 text-slate-800 font-semibold border-b border-slate-100 pb-2">
              <Laptop className="size-4 text-teal-600" />
              <span>桌面应用设置</span>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <div>
                  <label htmlFor="globalShortcutInput" className="font-medium text-slate-700">
                    呼出快捷键
                  </label>
                  <p className="text-[11px] text-slate-400">
                    全局呼出与隐藏浮窗（例如 Alt+CommandOrControl+I）
                  </p>
                </div>
                <input
                  id="globalShortcutInput"
                  type="text"
                  value={appConfig.globalShortcut || ''}
                  onChange={(e) =>
                    setAppConfig(
                      (prev) => prev && { ...prev, globalShortcut: e.target.value },
                    )
                  }
                  placeholder="Alt+CommandOrControl+I"
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-700">始终置顶窗口</p>
                  <p className="text-[11px] text-slate-400">
                    开启后窗口失去焦点时不会自动隐藏
                  </p>
                </div>
                <Switch
                  checked={appConfig.pinned}
                  onChange={(val) =>
                    setAppConfig((prev) => prev && { ...prev, pinned: val })
                  }
                  aria-label="始终置顶窗口"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-slate-700">开机自动启动</p>
                  <p className="text-[11px] text-slate-400">登录 macOS 时在后台常驻菜单栏</p>
                </div>
                <Switch
                  checked={appConfig.launchAtLogin}
                  onChange={(val) =>
                    setAppConfig((prev) => prev && { ...prev, launchAtLogin: val })
                  }
                  aria-label="开机自动启动"
                />
              </div>

              <div className="space-y-1 pt-1">
                <label htmlFor="cfgServerUrl" className="font-medium text-slate-700">
                  服务连接地址
                </label>
                <input
                  id="cfgServerUrl"
                  type="url"
                  value={appConfig.serverUrl || ''}
                  onChange={(e) =>
                    setAppConfig((prev) => prev && { ...prev, serverUrl: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                />
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
