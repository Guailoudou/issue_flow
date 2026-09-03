import { AlertCircle, CircleDot, ExternalLink, Laptop, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { Spinner } from '../../components/Spinner';
import { tauriBridge } from '../../lib/tauri/bridge';
import { useWindowDrag } from '../../lib/tauri/useWindowDrag';
import type { PublicPairingCreateResponse } from '../../lib/types';

export function AuthFlow({ onAuthenticated }: { onAuthenticated: () => void }) {
  const handleWindowDrag = useWindowDrag();
  const [serverUrl, setServerUrl] = useState('http://localhost:3101');
  const [pairingSession, setPairingSession] = useState<{
    sessionId: string;
    data: PublicPairingCreateResponse;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transientWarning, setTransientWarning] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const sessionInFlightRef = useRef<boolean>(false);

  // Load existing server URL if configured
  useEffect(() => {
    tauriBridge.getAppConfig().then((cfg) => {
      if (cfg.serverUrl) setServerUrl(cfg.serverUrl);
    });
  }, []);

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const handleStartPairing = async () => {
    if (isCancelling) return;

    const sessionId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `sess_${Date.now()}_${Math.random()}`;

    activeSessionIdRef.current = sessionId;
    sessionInFlightRef.current = false;
    clearPollTimer();
    setLoading(true);
    setError(null);
    setTransientWarning(null);

    try {
      const resp = await tauriBridge.startPairing(serverUrl, 'Mac 浮窗');
      if (activeSessionIdRef.current !== sessionId) return;

      setPairingSession({ sessionId, data: resp });
      const expiresAt = new Date(resp.expiresAt).getTime();
      const now = Date.now();
      setRemainingSeconds(Math.max(0, Math.floor((expiresAt - now) / 1000)));
    } catch (err) {
      if (activeSessionIdRef.current === sessionId) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (activeSessionIdRef.current === sessionId) {
        setLoading(false);
      }
    }
  };

  // Stable countdown timer per pairing session
  useEffect(() => {
    if (!pairingSession) return;
    const { sessionId, data } = pairingSession;
    const expiresTimestamp = new Date(data.expiresAt).getTime();

    const interval = setInterval(() => {
      if (activeSessionIdRef.current !== sessionId) {
        clearInterval(interval);
        return;
      }
      const remaining = Math.max(0, Math.floor((expiresTimestamp - Date.now()) / 1000));
      setRemainingSeconds(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
        if (activeSessionIdRef.current === sessionId) {
          setError('授权请求已过期，请重新发起配对');
          setPairingSession(null);
        }
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [pairingSession]);

  // Sequential non-overlapping polling with per-session ID isolation
  useEffect(() => {
    if (!pairingSession) {
      clearPollTimer();
      return;
    }

    const { sessionId, data } = pairingSession;

    const schedulePoll = (delayMs: number) => {
      clearPollTimer();
      if (activeSessionIdRef.current !== sessionId) return;
      pollTimerRef.current = setTimeout(runPoll, delayMs);
    };

    const runPoll = async () => {
      if (activeSessionIdRef.current !== sessionId || sessionInFlightRef.current) return;
      sessionInFlightRef.current = true;

      try {
        const res = await tauriBridge.pollPairingStatus();
        if (activeSessionIdRef.current !== sessionId) return;

        setTransientWarning(null);

        if (res.status === 'AUTHORIZED') {
          clearPollTimer();
          activeSessionIdRef.current = null;
          onAuthenticated();
          return;
        }

        if (res.status === 'PENDING') {
          const delaySec = res.retryAfterSeconds || data.pollIntervalSeconds || 3;
          schedulePoll(delaySec * 1000);
        }
      } catch (err) {
        if (activeSessionIdRef.current !== sessionId) return;

        const errStr = err instanceof Error ? err.message : String(err);
        const upper = errStr.toUpperCase();

        if (
          errStr.includes('PAIRING_COMMIT_FAILED_REVOKE_FAILED') ||
          errStr.includes('PAIRING_STALE_SESSION_REVOKE_FAILED')
        ) {
          clearPollTimer();
          activeSessionIdRef.current = null;
          setError(
            `本地配对提交失败且服务端凭据撤销失败，请前往 Web 端手动撤销该设备 Token（${errStr}）`,
          );
          setPairingSession(null);
          return;
        }

        if (errStr.includes('PAIRING_CONFIG_SAVE_FAILED')) {
          clearPollTimer();
          activeSessionIdRef.current = null;
          setError('保存连接配置失败，请重试');
          setPairingSession(null);
          return;
        }

        if (errStr.includes('PAIRING_TOKEN_SAVE_FAILED')) {
          clearPollTimer();
          activeSessionIdRef.current = null;
          setError('保存认证凭据失败，请重试');
          setPairingSession(null);
          return;
        }

        if (errStr.includes('PAIRING_STALE_SESSION')) {
          clearPollTimer();
          activeSessionIdRef.current = null;
          setError('配对会话已失效，请重新发起配对');
          setPairingSession(null);
          return;
        }

        if (upper.includes('EXPIRED') || upper.includes('410') || errStr.includes('过期')) {
          clearPollTimer();
          activeSessionIdRef.current = null;
          setError('授权请求已过期，请重新发起配对');
          setPairingSession(null);
          return;
        }

        if (
          upper.includes('CONSUMED') ||
          upper.includes('ALREADY') ||
          upper.includes('409') ||
          errStr.includes('已使用') ||
          errStr.includes('已消费')
        ) {
          clearPollTimer();
          activeSessionIdRef.current = null;
          setError('配对码已被使用，请重新发起配对');
          setPairingSession(null);
          return;
        }

        if (upper.includes('NOT_FOUND') || upper.includes('404') || errStr.includes('不存在')) {
          clearPollTimer();
          activeSessionIdRef.current = null;
          setError('配对请求不存在，请重新发起配对');
          setPairingSession(null);
          return;
        }

        // Transient network error: show non-blocking warning and retry with backoff
        setTransientWarning('网络连接暂不稳定，正在自动重试…');
        const fallbackDelay = Math.max(data.pollIntervalSeconds || 3, 5) * 1000;
        schedulePoll(fallbackDelay);
      } finally {
        if (activeSessionIdRef.current === sessionId) {
          sessionInFlightRef.current = false;
        }
      }
    };

    // First poll scheduled after initial pollIntervalSeconds
    const initialDelay = (data.pollIntervalSeconds || 3) * 1000;
    schedulePoll(initialDelay);

    return () => {
      clearPollTimer();
    };
  }, [pairingSession, onAuthenticated, clearPollTimer]);

  const handleReopenBrowser = () => {
    tauriBridge.reopenPairingAuthorization().catch(() => {});
  };

  const handleCancelPairing = async () => {
    if (!pairingSession || isCancelling) return;
    const currentPairingId = pairingSession.data.pairingId;
    activeSessionIdRef.current = null;
    sessionInFlightRef.current = false;
    clearPollTimer();
    setIsCancelling(true);
    try {
      await tauriBridge.cancelPairing(currentPairingId);
    } catch {
      // Ignore
    } finally {
      setIsCancelling(false);
      setPairingSession(null);
      setTransientWarning(null);
    }
  };

  const formatCountdown = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="flex h-full flex-col justify-between p-6 bg-slate-50 text-slate-800">
      <div className="space-y-6">
        <div className="flex cursor-move items-center gap-2.5" onMouseDown={handleWindowDrag}>
          <div className="flex size-9 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
            <CircleDot className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 tracking-tight">IssueFlow 桌面浮窗</h1>
            <p className="text-xs text-slate-500">连接到您的 IssueFlow 服务以开始使用</p>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex items-start gap-2">
            <ShieldAlert className="size-4 shrink-0 text-red-500 mt-0.5" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {transientWarning && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0 text-amber-600" aria-hidden="true" />
            <span>{transientWarning}</span>
          </div>
        )}

        {!pairingSession ? (
          <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="space-y-1.5">
              <label htmlFor="serverUrl" className="text-xs font-semibold text-slate-700">
                服务地址
              </label>
              <input
                id="serverUrl"
                type="url"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="http://localhost:3101"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono text-slate-800 focus:border-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              />
              <p className="text-[11px] text-slate-400">
                支持团队自建 IssueFlow 服务或本地开发地址
              </p>
            </div>

            <Button
              variant="teal"
              loading={loading}
              disabled={isCancelling}
              onClick={handleStartPairing}
              className="w-full"
              icon={<Laptop className="size-4" aria-hidden="true" />}
            >
              浏览器授权登录
            </Button>
          </div>
        ) : (
          <div className="space-y-5 rounded-xl border border-teal-200 bg-white p-5 shadow-sm text-center">
            <div className="space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-wider text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full">
                设备配对码
              </span>
              <div className="pt-2 text-3xl font-mono font-bold tracking-widest text-slate-900 select-all">
                {pairingSession.data.userCode}
              </div>
              <p className="text-xs text-slate-500 pt-1">
                有效期剩余：
                <span className="font-mono text-teal-700 font-semibold">
                  {formatCountdown(remainingSeconds)}
                </span>
              </p>
            </div>

            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 text-left space-y-1">
              <p className="font-medium text-slate-700">已在默认浏览器中打开授权页</p>
              <p className="text-[11px] text-slate-500">
                请在浏览器中核对配对码并点击“批准授权”。若未自动打开，请点击下方按钮。
              </p>
            </div>

            <div className="space-y-2">
              <Button
                variant="teal"
                onClick={handleReopenBrowser}
                disabled={isCancelling}
                className="w-full"
                icon={<ExternalLink className="size-4" aria-hidden="true" />}
              >
                重新打开授权页面
              </Button>
              <Button
                variant="ghost"
                loading={isCancelling}
                disabled={isCancelling}
                onClick={handleCancelPairing}
                className="w-full text-xs text-slate-500"
              >
                取消
              </Button>
            </div>

            <div className="flex items-center justify-center gap-1.5 text-xs text-slate-400 pt-1">
              <Spinner label="等待网页授权确认中…" className="p-0 !flex-row !gap-1.5" />
            </div>
          </div>
        )}
      </div>

      <div className="text-center text-[11px] text-slate-400">
        授权 Token 将保存在 macOS Keychain，不会暴露给网页或本地日志
      </div>
    </div>
  );
}
