/**
 * Minimal history-API router. The original app is hash-tab based at "/"
 * (#investigate, #coach, ...) and keeps working unchanged; the account pages
 * are path based (/dashboard/outlook, /admin, ...). No dependency needed.
 */
import { useCallback, useEffect, useState } from 'react';
import type { AppTab } from './types';

export type Page =
  | { kind: 'tabs'; tab: AppTab }
  | { kind: 'login' }
  | { kind: 'mailbox'; provider: 'outlook' | 'gmail' }
  | { kind: 'threats' }
  | { kind: 'notifications' }
  | { kind: 'settings' }
  | { kind: 'admin'; section: 'overview' | 'users' | 'threats' | 'health' | 'audit' }
  | { kind: 'not_found' };

const VALID_TABS: AppTab[] = ['home', 'investigate', 'domain', 'incident', 'coach', 'dashboard', 'history'];

export function tabFromHash(hash: string): AppTab {
  const h = hash.replace('#', '') as AppTab;
  return VALID_TABS.includes(h) ? h : 'home';
}

export function parsePage(pathname: string, hash: string): Page {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return { kind: 'tabs', tab: tabFromHash(hash) };
  if (path === '/login' || path === '/register') return { kind: 'login' };
  if (path === '/dashboard' || path === '/home') return { kind: 'tabs', tab: 'home' };
  if (path === '/dashboard/outlook' || path === '/outlook') return { kind: 'mailbox', provider: 'outlook' };
  if (path === '/dashboard/gmail' || path === '/gmail') return { kind: 'mailbox', provider: 'gmail' };
  if (path === '/threats') return { kind: 'threats' };
  if (path === '/notifications') return { kind: 'notifications' };
  if (path === '/settings') return { kind: 'settings' };
  if (path === '/investigate' || path === '/links' || path === '/incident' || path === '/coach' || path === '/history') return { kind: 'tabs', tab: (path === '/links' ? 'domain' : path.slice(1)) as AppTab };
  if (path === '/admin') return { kind: 'admin', section: 'overview' };
  const admin = path.match(/^\/admin\/(users|threats|health|audit)$/);
  if (admin) return { kind: 'admin', section: admin[1] as 'users' | 'threats' | 'health' | 'audit' };
  return { kind: 'not_found' };
}

export interface RouterState {
  page: Page;
  pathname: string;
  search: URLSearchParams;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
  /** Switch a hash tab on the home route (keeps the original deep links working). */
  setTab: (tab: AppTab) => void;
}

export function useRouter(): RouterState {
  const read = () => ({ pathname: window.location.pathname, hash: window.location.hash, search: window.location.search });
  const [loc, setLoc] = useState(read);

  useEffect(() => {
    const onChange = () => setLoc(read());
    window.addEventListener('popstate', onChange);
    window.addEventListener('hashchange', onChange);
    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener('hashchange', onChange);
    };
  }, []);

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (opts?.replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    setLoc(read());
    window.scrollTo({ top: 0 });
  }, []);

  const setTab = useCallback((tab: AppTab) => {
    const target = `/#${tab}`;
    if (window.location.pathname !== '/' ) window.history.pushState(null, '', target);
    else if (window.location.hash !== `#${tab}`) window.history.replaceState(null, '', target);
    setLoc(read());
  }, []);

  return { page: parsePage(loc.pathname, loc.hash), pathname: loc.pathname, search: new URLSearchParams(loc.search), navigate, setTab };
}
