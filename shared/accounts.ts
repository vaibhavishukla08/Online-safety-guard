/**
 * Shared contracts for accounts, mailbox connections, stored email analyses,
 * notifications and the admin dashboard. Imported by server/ and src/.
 * Keep this file free of runtime dependencies.
 */
import type { EngineMode, InvestigationReport, RiskLevel } from './investigation';

export type UserRole = 'USER' | 'ADMIN';
export type UserStatus = 'active' | 'suspended';
export type NotifyPolicy = 'high_only' | 'suspicious_and_high' | 'all' | 'off';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  notifyPolicy: NotifyPolicy;
  createdAt: string;
  lastActiveAt: string | null;
}

export type EmailProviderId = 'outlook' | 'gmail';
export const EMAIL_PROVIDERS: EmailProviderId[] = ['outlook', 'gmail'];

export type ConnectionState = 'not_connected' | 'active' | 'expired' | 'error' | 'not_configured';

export interface ConnectionStatus {
  provider: EmailProviderId;
  state: ConnectionState;
  /** Whether the server has OAuth credentials for this provider at all. */
  configured: boolean;
  accountEmail: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  lastSyncSummary: string | null;
  scopes: string[];
  /** Number of stored messages / analysed messages for this provider. */
  messageCount: number;
  analyzedCount: number;
}

export type AnalysisStatus = 'not_analyzed' | 'analyzing' | 'analyzed' | 'failed';

/** Provider-independent email record as exposed to the web app. */
export interface EmailRecord {
  id: string;
  provider: EmailProviderId;
  providerMessageId: string;
  providerItemId: string | null;
  internetMessageId: string | null;
  threadId: string | null;
  senderName: string | null;
  senderEmail: string | null;
  recipients: string[];
  subject: string;
  snippet: string | null;
  receivedAt: string | null;
  isRead: boolean | null;
  hasAttachments: boolean;
  urls: string[];
  webLink: string | null;
  prefilterScore: number | null;
  riskScore: number | null;
  riskLevel: RiskLevel | null;
  threatCategory: string | null;
  analysisStatus: AnalysisStatus;
  analysisEngine: EngineMode | null;
  analysisError: string | null;
  analyzedAt: string | null;
  /** How the record entered the system. */
  source: 'addin' | 'sync' | 'manual' | null;
  createdAt: string;
  updatedAt: string;
}

/** Full record including the stored investigation (body reduced to an excerpt). */
export interface EmailRecordDetail extends EmailRecord {
  analysis: InvestigationReport | null;
}

export interface EmailListQuery {
  provider?: EmailProviderId | 'all';
  search?: string;
  filter?: 'all' | 'safe' | 'low' | 'medium' | 'high' | 'critical' | 'analyzed' | 'not_analyzed';
  page?: number;
  pageSize?: number;
  sort?: 'received' | 'risk';
}

export interface EmailListResult {
  items: EmailRecord[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export type NotificationStatus = 'unread' | 'read' | 'dismissed';

export interface NotificationItem {
  id: string;
  emailId: string;
  provider: EmailProviderId;
  level: RiskLevel;
  riskScore: number;
  title: string;
  body: string;
  sender: string | null;
  status: NotificationStatus;
  createdAt: string;
  readAt: string | null;
}

export interface SyncResult {
  provider: EmailProviderId;
  fetched: number;
  newRecords: number;
  autoAnalyzed: number;
  notificationsCreated: number;
  skippedByPolicy: number;
  durationMs: number;
  error: string | null;
}

export interface AddinTokenInfo {
  id: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
}

export type AuditAction =
  | 'user_registered'
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'outlook_connected'
  | 'outlook_disconnected'
  | 'gmail_connected'
  | 'gmail_disconnected'
  | 'mailbox_synced'
  | 'email_analyzed'
  | 'notification_generated'
  | 'addin_linked'
  | 'addin_token_revoked'
  | 'history_deleted'
  | 'settings_changed'
  | 'admin_action';

export interface AuditEntry {
  id: string;
  userId: string | null;
  actorRole: string | null;
  action: AuditAction | string;
  detail: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export interface AdminOverview {
  totalUsers: number;
  activeUsers7d: number;
  connectedOutlook: number;
  connectedGmail: number;
  emailsStored: number;
  emailsAnalyzed: number;
  highRiskDetections: number;
  suspiciousDetections: number;
  notificationsSent: number;
  serviceHealth: ServiceHealthReport;
}

export interface AdminUserRow extends PublicUser {
  providers: EmailProviderId[];
  analysisCount: number;
  highRiskCount: number;
}

export interface ThreatAnalytics {
  totalAnalyzed: number;
  totalThreats: number;
  byCategory: Array<{ label: string; count: number }>;
  riskDistribution: Record<RiskLevel, number>;
  commonSignals: Array<{ label: string; count: number }>;
  suspiciousDomains: Array<{ domain: string; count: number; maxScore: number }>;
  recent: Array<{ id: string; userId: string; provider: EmailProviderId; subject: string; senderEmail: string | null; riskScore: number; riskLevel: RiskLevel; threatCategory: string | null; analyzedAt: string }>;
  trend: Array<{ day: string; analyzed: number; threats: number }>;
}

export type ServiceState = 'ok' | 'degraded' | 'down' | 'not_configured' | 'unknown';

export interface ServiceStatus {
  id: string;
  label: string;
  state: ServiceState;
  detail: string;
  /** Calls observed in the last hour. */
  calls: number;
  failures: number;
  lastFailureAt: string | null;
  lastFailure: string | null;
}

export interface ServiceHealthReport {
  generatedAt: string;
  uptimeSec: number;
  database: { kind: string; ok: boolean };
  services: ServiceStatus[];
  errorRate: number;
  recentFailures: Array<{ service: string; message: string; at: string }>;
  rateLimit: { perMinute: number; activeClients: number; blockedLastHour: number };
  sync: { enabled: boolean; intervalMinutes: number; lastRunAt: string | null; lastRunSummary: string | null };
}
