/**
 * Schema — dialect-neutral DDL applied on every boot (idempotent).
 *
 * Privacy by design: email_records holds metadata plus the stored analysis; the
 * analysed body is reduced to a short excerpt (LIMITS.storedExcerptChars).
 * OAuth tokens are stored encrypted (AES-256-GCM); passwords as scrypt hashes;
 * session and add-in tokens only as SHA-256 hashes.
 */
export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'USER',
    status TEXT NOT NULL DEFAULT 'active',
    notify_policy TEXT NOT NULL DEFAULT 'high_only',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_active_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS addin_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_used_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_addin_tokens_user ON addin_tokens(user_id)`,
  `CREATE TABLE IF NOT EXISTS link_codes (
    code TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    code_verifier TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS provider_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    account_email TEXT,
    account_id TEXT,
    access_token_enc TEXT,
    refresh_token_enc TEXT,
    token_expires_at TEXT,
    scopes TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    last_sync_at TEXT,
    last_sync_error TEXT,
    last_sync_summary TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, provider)
  )`,
  `CREATE TABLE IF NOT EXISTS email_records (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_message_id TEXT NOT NULL,
    provider_item_id TEXT,
    internet_message_id TEXT,
    thread_id TEXT,
    sender_name TEXT,
    sender_email TEXT,
    recipients TEXT,
    subject TEXT NOT NULL DEFAULT '',
    snippet TEXT,
    received_at TEXT,
    is_read INTEGER,
    has_attachments INTEGER NOT NULL DEFAULT 0,
    urls TEXT NOT NULL DEFAULT '[]',
    web_link TEXT,
    prefilter_score INTEGER,
    risk_score INTEGER,
    risk_level TEXT,
    threat_category TEXT,
    analysis_status TEXT NOT NULL DEFAULT 'not_analyzed',
    analysis_engine TEXT,
    analysis_error TEXT,
    analysis_result TEXT,
    analyzed_at TEXT,
    source TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, provider, provider_message_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_email_records_user_provider ON email_records(user_id, provider, received_at)`,
  `CREATE INDEX IF NOT EXISTS idx_email_records_user_risk ON email_records(user_id, risk_score)`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    email_id TEXT NOT NULL,
    level TEXT NOT NULL,
    risk_score INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    sender TEXT,
    provider TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unread',
    created_at TEXT NOT NULL,
    read_at TEXT,
    UNIQUE(user_id, email_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user_status ON notifications(user_id, status, created_at)`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    actor_role TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    ip TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id, created_at)`,
];
