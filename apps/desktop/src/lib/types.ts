import type {
  DesktopApiToken,
  DesktopIssueSummary,
  DesktopLabelSummary,
  DesktopNotification,
  DesktopOverview,
  DesktopPreference,
  DesktopUserSummary,
  PublicUser,
  RealtimeEvent,
  UpdateDesktopPreferenceInput,
} from '@issueflow/shared';

export type {
  DesktopApiToken,
  DesktopIssueSummary,
  DesktopLabelSummary,
  DesktopNotification,
  DesktopOverview,
  DesktopPreference,
  DesktopUserSummary,
  PublicUser,
  RealtimeEvent,
  UpdateDesktopPreferenceInput,
};

// Aliases for component convenience
export type DesktopIssueItem = DesktopIssueSummary;
export type DesktopOverviewData = DesktopOverview;
export type DesktopPreferenceData = DesktopPreference;
export type UpdateDesktopPreferencePayload = UpdateDesktopPreferenceInput;
export type PublicUserInfo = PublicUser;

// Rust-specific public pairing response (no deviceSecret or verificationUrl)
export interface PublicPairingCreateResponse {
  pairingId: string;
  userCode: string;
  expiresAt: string;
  pollIntervalSeconds: number;
}

// Pairing exchange result returned from Rust
export type PublicPairingExchangeResult =
  | { status: 'PENDING'; expiresAt: string; retryAfterSeconds: number }
  | { status: 'AUTHORIZED'; apiToken: DesktopApiToken };

// Minimal issue state update result returned from Rust (PATCH /api/issues/:id)
export interface IssueStateUpdateResult {
  id: number;
  state: 'OPEN' | 'CLOSED';
  updatedAt: string;
  closedAt: string | null;
}

export interface AuthStatusResponse {
  authenticated: boolean;
  user: PublicUser | null;
}

export interface AppConfig {
  serverUrl: string;
  globalShortcut: string;
  launchAtLogin: boolean;
  pinned: boolean;
}

export type RealtimeStatus = 'connected' | 'connecting' | 'disconnected' | 'unauthenticated';

export interface RealtimeStatusEnvelope {
  origin: string;
  userId: number | null;
  generation: number;
  status: RealtimeStatus;
}

export interface RealtimeEventEnvelope {
  origin: string;
  userId: number;
  generation: number;
  event: RealtimeEvent;
}

