/**
 * Session + notification state for the web app.
 *
 * - Resolves the signed-in user from the HTTP-only session cookie (/api/auth/me).
 * - Polls /api/notifications every 60s while signed in and the tab is visible.
 *   This is polling: the UI never claims real-time detection.
 * - Optionally mirrors *new* unread notifications to the browser Notification
 *   API when the user has granted permission and enabled it in Settings.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { accountApi, notificationsApi } from '../api/client';
import type { NotificationItem, PublicUser } from '../types';

export const BROWSER_NOTIFY_KEY = 'osg_browser_notifications';
const POLL_MS = 60_000;

interface AuthState {
  user: PublicUser | null;
  status: 'loading' | 'anonymous' | 'authenticated';
  error: string | null;
  refresh: () => Promise<PublicUser | null>;
  login: (email: string, password: string) => Promise<string | null>;
  register: (email: string, password: string, name: string) => Promise<string | null>;
  logout: () => Promise<void>;
  updateUser: (patch: { name?: string; notifyPolicy?: PublicUser['notifyPolicy'] }) => Promise<string | null>;
  notifications: NotificationItem[];
  unread: number;
  refreshNotifications: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function browserNotificationsEnabled(): boolean {
  try {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted' && localStorage.getItem(BROWSER_NOTIFY_KEY) === 'on';
  } catch {
    return false;
  }
}

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const seenIds = useRef<Set<string> | null>(null);

  const refresh = useCallback(async () => {
    const res = await accountApi.me();
    if (res.ok) {
      setUser(res.data.user);
      setStatus('authenticated');
      return res.data.user;
    }
    setUser(null);
    setStatus('anonymous');
    if (res.error.status === 0) setError(res.error.message);
    return null;
  }, []);

  const refreshNotifications = useCallback(async () => {
    const res = await notificationsApi.list('active', 30);
    if (!res.ok) return;
    setNotifications(res.data.items);
    setUnread(res.data.unread);
    const fresh = res.data.items.filter((n) => n.status === 'unread');
    if (seenIds.current === null) {
      seenIds.current = new Set(fresh.map((n) => n.id));
      return;
    }
    const unseen = fresh.filter((n) => !seenIds.current!.has(n.id));
    for (const n of unseen) seenIds.current.add(n.id);
    if (unseen.length && browserNotificationsEnabled()) {
      try {
        const first = unseen[0];
        new Notification(`Online Safety Guard: ${first.title}`, { body: `${first.sender ? `From ${first.sender}. ` : ''}${first.body}${unseen.length > 1 ? ` (+${unseen.length - 1} more)` : ''}`, tag: `osg-${first.id}` });
      } catch {
        /* notification blocked at runtime — in-app list still shows it */
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (status !== 'authenticated') {
      setNotifications([]);
      setUnread(0);
      seenIds.current = null;
      return;
    }
    void refreshNotifications();
    const tick = () => {
      if (document.visibilityState === 'visible') void refreshNotifications();
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [status, refreshNotifications]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await accountApi.login(email, password);
    if (!res.ok) return res.error.message;
    setUser(res.data.user);
    setStatus('authenticated');
    return null;
  }, []);

  const register = useCallback(async (email: string, password: string, name: string) => {
    const res = await accountApi.register(email, password, name);
    if (!res.ok) return res.error.message;
    setUser(res.data.user);
    setStatus('authenticated');
    return null;
  }, []);

  const logout = useCallback(async () => {
    await accountApi.logout();
    setUser(null);
    setStatus('anonymous');
  }, []);

  const updateUser = useCallback(async (patch: { name?: string; notifyPolicy?: PublicUser['notifyPolicy'] }) => {
    const res = await accountApi.update(patch);
    if (!res.ok) return res.error.message;
    setUser(res.data.user);
    return null;
  }, []);

  const markRead = useCallback(async (id: string) => {
    await notificationsApi.markRead(id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, status: 'read' } : n)));
    setUnread((u) => Math.max(0, u - 1));
  }, []);

  const dismiss = useCallback(async (id: string) => {
    const wasUnread = notifications.find((n) => n.id === id)?.status === 'unread';
    await notificationsApi.dismiss(id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    if (wasUnread) setUnread((u) => Math.max(0, u - 1));
  }, [notifications]);

  const markAllRead = useCallback(async () => {
    await notificationsApi.readAll();
    setNotifications((prev) => prev.map((n) => (n.status === 'unread' ? { ...n, status: 'read' } : n)));
    setUnread(0);
  }, []);

  const value = useMemo<AuthState>(() => ({ user, status, error, refresh, login, register, logout, updateUser, notifications, unread, refreshNotifications, markRead, dismiss, markAllRead }), [user, status, error, refresh, login, register, logout, updateUser, notifications, unread, refreshNotifications, markRead, dismiss, markAllRead]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
