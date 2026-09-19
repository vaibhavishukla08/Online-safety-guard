import React, { useEffect, useState } from 'react';
import { LogIn, UserPlus, Loader2, ShieldCheck, Mail, Inbox, Bell } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { Card, Notice, PrimaryButton } from '../components/ui/primitives';

interface Props {
  next: string | null;
  onNavigate: (to: string, opts?: { replace?: boolean }) => void;
}

export const AuthPage: React.FC<Props> = ({ next, onNavigate }) => {
  const { status, login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>(window.location.pathname === '/register' ? 'register' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  useEffect(() => {
    if (status === 'authenticated') onNavigate(target, { replace: true });
  }, [status, target, onNavigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = mode === 'login' ? await login(email, password) : await register(email, password, name);
    setBusy(false);
    if (err) setError(err);
  };

  const input = 'w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/90 border border-slate-300 dark:border-slate-800 text-slate-900 dark:text-slate-100 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/40 transition-colors';

  return (
    <div className="max-w-4xl mx-auto grid md:grid-cols-5 gap-6 animate-fadeIn">
      <Card className="md:col-span-3">
        <div className="flex items-center gap-2 mb-1">
          {mode === 'login' ? <LogIn className="w-5 h-5 text-rose-600" aria-hidden="true" /> : <UserPlus className="w-5 h-5 text-rose-600" aria-hidden="true" />}
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{mode === 'login' ? 'Sign in' : 'Create your account'}</h2>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">
          {mode === 'login' ? 'Access your mailbox history, saved analyses and notifications.' : 'Your account keeps mailbox history and analyses private to you.'}
        </p>
        <form onSubmit={submit} className="space-y-3">
          {mode === 'register' && (
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Name
              <input id="auth-name" className={`${input} mt-1`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" />
            </label>
          )}
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Email
            <input id="auth-email" type="email" required className={`${input} mt-1`} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
          </label>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Password
            <input id="auth-password" type="password" required minLength={8} className={`${input} mt-1`} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'register' ? 'At least 8 characters' : 'Your password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </label>
          {error && <Notice tone="error">{error}</Notice>}
          <PrimaryButton id="auth-submit" type="submit" disabled={busy || !email || password.length < 8} className="w-full">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : mode === 'login' ? <LogIn className="w-4 h-4" aria-hidden="true" /> : <UserPlus className="w-4 h-4" aria-hidden="true" />}
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </PrimaryButton>
        </form>
        <button type="button" id="auth-switch" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }} className="mt-4 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:underline cursor-pointer">
          {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      </Card>

      <Card className="md:col-span-2 space-y-3 text-xs text-slate-700 dark:text-slate-300">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-600" aria-hidden="true" /> What an account adds</h3>
        <p className="flex items-start gap-2"><Mail className="w-4 h-4 mt-0.5 text-blue-600 flex-shrink-0" aria-hidden="true" /> <span><strong>Outlook</strong> — analyses run from the Outlook add-in are saved to your history; connect your mailbox to sync recent mail.</span></p>
        <p className="flex items-start gap-2"><Inbox className="w-4 h-4 mt-0.5 text-red-600 flex-shrink-0" aria-hidden="true" /> <span><strong>Gmail</strong> — connect with Google to see and analyse recent Gmail messages.</span></p>
        <p className="flex items-start gap-2"><Bell className="w-4 h-4 mt-0.5 text-purple-600 flex-shrink-0" aria-hidden="true" /> <span><strong>Notifications</strong> — high-risk emails found during a sync show up on your dashboard.</span></p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200 dark:border-slate-800">Passwords are stored as scrypt hashes; mailbox access is read-only and revocable at any time from Settings. Full email bodies are not kept — only the analysis and a short excerpt.</p>
      </Card>
    </div>
  );
};
