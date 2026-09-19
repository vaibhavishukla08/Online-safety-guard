import React, { useEffect, useState } from 'react';
import { Bell, BellOff, CheckCheck, Loader2, Settings } from 'lucide-react';
import type { NotificationItem } from '../types';
import { notificationsApi } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Card, EmptyState, Notice, SecondaryButton } from '../components/ui/primitives';
import { RequireAuth } from '../components/mail/shared';
import { NotificationCard } from '../components/NotificationCard';

interface Props {
  onNavigate: (to: string, opts?: { replace?: boolean }) => void;
}

export const NotificationsPage: React.FC<Props> = ({ onNavigate }) => (
  <RequireAuth onNavigate={onNavigate} feature="notifications">
    <NotificationsInner onNavigate={onNavigate} />
  </RequireAuth>
);

const NotificationsInner: React.FC<Props> = ({ onNavigate }) => {
  const { user, unread, markRead, dismiss, markAllRead, refreshNotifications } = useAuth();
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await notificationsApi.list(scope, 100);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setItems(res.data.items);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, unread]);

  const handleRead = async (id: string) => {
    await markRead(id);
    setItems((prev) => prev?.map((n) => (n.id === id ? { ...n, status: 'read' } : n)) || prev);
  };
  const handleDismiss = async (id: string) => {
    await dismiss(id);
    setItems((prev) => (scope === 'all' ? prev?.map((n) => (n.id === id ? { ...n, status: 'dismissed' } : n)) || prev : prev?.filter((n) => n.id !== id) || prev));
  };

  const policyLabel = { high_only: 'High-risk only', suspicious_and_high: 'Suspicious + high risk', all: 'All threats', off: 'Disabled' }[user?.notifyPolicy || 'high_only'];

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white flex items-center gap-2"><Bell className="w-7 h-7 text-purple-600" aria-hidden="true" /> Notifications</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">Security alerts generated when a synced or analysed email meets your notification setting (<strong>{policyLabel}</strong>). One alert per email — never duplicates.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-xs font-semibold" role="group">
            {(['active', 'all'] as const).map((s) => (
              <button key={s} type="button" onClick={() => setScope(s)} aria-pressed={scope === s} className={`px-3 py-1.5 cursor-pointer ${scope === s ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400'}`}>{s === 'active' ? 'Active' : 'Including dismissed'}</button>
            ))}
          </div>
          <SecondaryButton onClick={() => { void markAllRead(); void refreshNotifications(); }} disabled={unread === 0}><CheckCheck className="w-3.5 h-3.5" aria-hidden="true" /> Mark all read</SecondaryButton>
          <SecondaryButton onClick={() => onNavigate('/settings')}><Settings className="w-3.5 h-3.5" aria-hidden="true" /> Settings</SecondaryButton>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {user?.notifyPolicy === 'off' && <Notice tone="warn"><BellOff className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" /> Notifications are disabled in your settings — new detections will not create alerts.</Notice>}
      {items === null ? (
        <Card className="flex items-center justify-center gap-2 py-10 text-sm text-slate-600 dark:text-slate-400"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading…</Card>
      ) : items.length === 0 ? (
        <Card><EmptyState icon={Bell} title="No notifications" body="Alerts appear here when a mailbox sync or an add-in analysis finds an email that meets your notification setting." /></Card>
      ) : (
        <div className="space-y-3">
          {items.map((n) => <NotificationCard key={n.id} item={n} onNavigate={onNavigate} onMarkRead={handleRead} onDismiss={handleDismiss} />)}
        </div>
      )}
    </div>
  );
};
