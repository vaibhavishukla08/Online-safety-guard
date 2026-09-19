import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Check, Clipboard, Globe, Image as ImageIcon, Link2, Loader2, Mail, MessageSquare, MessagesSquare, ScanEye, Smartphone, Sparkles, Upload, X, Zap, FlaskConical, Workflow,
} from 'lucide-react';
import { PRESET_MESSAGES } from '../data/presets';
import type { InvestigateMode, InvestigationReport, InvestigationSeed, PresetMessage, TraceStep } from '../types';
import { investigateStream, type InvestigateRequest } from '../api/client';
import { InvestigationTrace } from './investigation/InvestigationTrace';
import { Card, Notice, PrimaryButton } from './ui/primitives';

interface Props {
  seed?: InvestigationSeed | null;
  onSeedConsumed?: () => void;
  onComplete: (report: InvestigationReport) => void;
  aiConfigured: boolean | null;
}

const PLATFORMS = [
  { id: 'SMS / Text', label: 'SMS / Text', icon: Smartphone },
  { id: 'Email / Inbox', label: 'Email / Inbox', icon: Mail },
  { id: 'WhatsApp', label: 'WhatsApp', icon: MessageSquare },
  { id: 'Instagram DM', label: 'Instagram DM', icon: MessageSquare },
  { id: 'Telegram', label: 'Telegram', icon: MessageSquare },
  { id: 'LinkedIn', label: 'LinkedIn', icon: Globe },
  { id: 'Other App', label: 'Other App', icon: Globe },
];

const MODES: Array<{ id: InvestigateMode; label: string; icon: React.ElementType; hint: string }> = [
  { id: 'message', label: 'Message', icon: MessageSquare, hint: 'Paste a text, email or DM' },
  { id: 'screenshot', label: 'Screenshot', icon: ScanEye, hint: 'Upload an image — we extract everything' },
  { id: 'url', label: 'URL', icon: Link2, hint: 'Investigate a link or domain' },
  { id: 'conversation', label: 'Conversation', icon: MessagesSquare, hint: 'Paste a whole chat thread' },
];

const SAMPLE_CONVERSATION = `Scammer: Congratulations! You have been selected for an online job.
User: What is the salary?
Scammer: ₹4,000 per day.
User: How do I join?
Scammer: First pay ₹1,999 registration fee.`;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const InvestigationConsole: React.FC<Props> = ({ seed, onSeedConsumed, onComplete, aiConfigured }) => {
  const [mode, setMode] = useState<InvestigateMode>('message');
  const [message, setMessage] = useState('');
  const [sender, setSender] = useState('');
  const [platform, setPlatform] = useState('SMS / Text');
  const [url, setUrl] = useState('');
  const [conversation, setConversation] = useState('');
  const [screenshot, setScreenshot] = useState<{ base64: string; mime: string; name: string } | null>(null);
  const [copiedSuccess, setCopiedSuccess] = useState(false);
  const [liveWarning, setLiveWarning] = useState<string | null>(null);
  const [demoTitle, setDemoTitle] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Live heuristic preview (kept from the original scanner).
  useEffect(() => {
    const text = (message + ' ' + sender + ' ' + url + ' ' + conversation).toLowerCase();
    if (/(\.top|\.xyz|\.cc|\.buzz|\.cam|\.tk|\.ml|\.ga|\.cf|\.gq|\.zip|\.mov)\b/i.test(text)) {
      setLiveWarning('Potentially hazardous domain extension detected (.top, .xyz, .cc, …) — commonly used by phishing kits.');
    } else if (/\botp\b|2fa code|passcode|gift card|upi pin/.test(text)) {
      setLiveWarning('Request for sensitive codes or untraceable payment detected. Genuine organizations never ask for these.');
    } else if (/within 15 minutes|account will be terminated|card suspended|blocked today/.test(text)) {
      setLiveWarning('Extreme time pressure detected. Scammers use artificial fear to provoke hasty action.');
    } else {
      setLiveWarning(null);
    }
  }, [message, sender, url, conversation]);

  const buildRequest = useCallback((): InvestigateRequest | null => {
    switch (mode) {
      case 'message':
        return message.trim() ? { mode, message: message.trim(), sender: sender.trim() || undefined, platform } : null;
      case 'screenshot':
        return screenshot ? { mode, imageBase64: screenshot.base64, imageMime: screenshot.mime, sender: sender.trim() || undefined, platform } : null;
      case 'url':
        return url.trim() ? { mode, url: url.trim(), message: message.trim() || undefined, platform } : null;
      case 'conversation':
        return conversation.trim() ? { mode, conversation: conversation.trim(), platform } : null;
    }
  }, [mode, message, sender, platform, screenshot, url, conversation]);

  const run = useCallback(async (override?: InvestigateRequest) => {
    const req = override || buildRequest();
    if (!req) {
      setError(mode === 'screenshot' ? 'Please upload a screenshot first.' : 'Please provide something to investigate.');
      return;
    }
    setRunning(true);
    setError(null);
    setTrace([]);
    const res = await investigateStream(req, (step) => {
      setTrace((prev) => {
        const idx = prev.findIndex((s) => s.id === step.id);
        if (idx === -1) return [...prev, step];
        const next = prev.slice();
        next[idx] = step;
        return next;
      });
    });
    setRunning(false);
    if (res.ok) {
      onComplete(res.data);
    } else {
      setError(res.error.message);
    }
  }, [buildRequest, mode, onComplete]);

  // Apply a seed from Home / Demo / Link Inspector.
  useEffect(() => {
    if (!seed) return;
    setMode(seed.mode);
    setMessage(seed.message || '');
    setSender(seed.sender || '');
    setPlatform(seed.platform || 'SMS / Text');
    setUrl(seed.url || '');
    setConversation(seed.conversation || '');
    setScreenshot(null);
    setError(null);
    setDemoTitle(seed.demoTitle || null);
    onSeedConsumed?.();
    if (seed.autoRun) {
      const req: InvestigateRequest = seed.mode === 'url'
        ? { mode: 'url', url: seed.url, message: seed.message, platform: seed.platform }
        : seed.mode === 'conversation'
          ? { mode: 'conversation', conversation: seed.conversation, platform: seed.platform }
          : { mode: 'message', message: seed.message, sender: seed.sender, platform: seed.platform };
      void run(req);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const loadPreset = (preset: PresetMessage) => {
    setMode('message');
    setMessage(preset.text);
    setSender(preset.sender);
    setPlatform(preset.platform);
    setScreenshot(null);
    setError(null);
    setDemoTitle(null);
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file (PNG, JPG, WebP).');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(`Screenshot is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Please use an image under 8 MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      setScreenshot({ base64: ev.target?.result as string, mime: file.type, name: file.name });
      setError(null);
    };
    reader.onerror = () => setError('Could not read that file. Try a different image.');
    reader.readAsDataURL(file);
  };

  const pasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        if (mode === 'conversation') setConversation(text);
        else if (mode === 'url') setUrl(text);
        else setMessage(text);
        setCopiedSuccess(true);
        setTimeout(() => setCopiedSuccess(false), 1500);
      }
    } catch {
      setError('Clipboard access was blocked — use Ctrl+V / Cmd+V to paste directly.');
    }
  };

  const canRun = Boolean(buildRequest()) && !running;

  // ------------------------------------------------------------------ running
  if (running) {
    return (
      <div className="space-y-5 animate-fadeIn">
        <Card className="border-rose-200 dark:border-rose-500/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center flex-shrink-0">
              <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Investigation in progress{demoTitle ? ` — ${demoTitle}` : ''}</h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">The Safety Orchestrator is selecting agents based on what it finds. {aiConfigured === false ? 'AI is not configured, so deterministic rules and external checks are used.' : 'This typically takes 5–15 seconds.'}</p>
            </div>
          </div>
        </Card>
        <InvestigationTrace steps={trace} live />
      </div>
    );
  }

  // ------------------------------------------------------------------- form
  return (
    <div className="space-y-5">
      {aiConfigured === false && (
        <Notice tone="warn">
          <strong>Deterministic mode.</strong> No <code className="font-mono">GEMINI_API_KEY</code> is configured, so AI understanding, screenshot reading and personalised plans are unavailable. Rule-based signals, URL analysis, identity checks and external lookups still run.
        </Notice>
      )}

      {/* Mode switch */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="tablist" aria-label="Investigation input type">
        {MODES.map((m) => {
          const Icon = m.icon;
          const on = mode === m.id;
          return (
            <button
              key={m.id}
              role="tab"
              aria-selected={on}
              id={`mode-${m.id}`}
              type="button"
              onClick={() => { setMode(m.id); setError(null); setDemoTitle(null); }}
              className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all cursor-pointer min-h-[56px] focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/60 ${on ? 'bg-rose-500/10 border-rose-400 dark:border-rose-500/60 shadow-xs' : 'bg-white/80 dark:bg-slate-900/70 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'}`}
            >
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${on ? 'bg-rose-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`} aria-hidden="true"><Icon className="w-4 h-4" /></span>
              <span className="min-w-0">
                <span className={`block text-xs font-bold ${on ? 'text-rose-800 dark:text-rose-200' : 'text-slate-900 dark:text-white'}`}>{m.label}</span>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">{m.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Presets (message mode) */}
      {mode === 'message' && (
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" aria-hidden="true" />
              <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">Quick test: common scam templates</h3>
            </div>
            <span className="text-[11px] text-slate-500 hidden sm:inline">Click to load, then investigate</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {PRESET_MESSAGES.map((preset) => (
              <button key={preset.id} type="button" id={`preset-${preset.id}`} onClick={() => loadPreset(preset)} className="p-2.5 text-left rounded-xl bg-slate-50/90 hover:bg-slate-100 dark:bg-slate-950/60 dark:hover:bg-slate-800/80 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-all group flex flex-col justify-between cursor-pointer min-h-[60px]">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors truncate">{preset.title}</span>
                <span className="flex items-center gap-1.5 mt-1">
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${preset.expectedRisk === 'DANGEROUS' ? 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300'}`}>{preset.badge}</span>
                  <span className="text-[10px] text-slate-500 truncate">{preset.platform}</span>
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Main form */}
      <form onSubmit={(e) => { e.preventDefault(); void run(); }} className="bg-white/90 dark:bg-slate-900/90 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-md dark:shadow-xl space-y-5 backdrop-blur-sm transition-colors">
        {/* Platform */}
        {mode !== 'url' && (
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-300 flex items-center justify-between">
              <span>Where did you receive this?</span>
              <span className="text-slate-500 text-[11px] font-normal">Context helps the Identity Agent</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => {
                const Icon = p.icon;
                const on = platform === p.id;
                return (
                  <button key={p.id} type="button" onClick={() => setPlatform(p.id)} aria-pressed={on} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer min-h-[36px] ${on ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/40 shadow-xs font-semibold' : 'bg-slate-100 dark:bg-slate-950/60 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-800/80 border border-slate-200 dark:border-slate-800'}`}>
                    <Icon className="w-3.5 h-3.5" aria-hidden="true" />{p.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Sender */}
        {(mode === 'message' || mode === 'screenshot') && (
          <div className="space-y-1.5">
            <label htmlFor="sender-input" className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-300 flex items-center justify-between">
              <span>Sender address, phone, or handle <span className="font-normal text-slate-500 normal-case">(optional{mode === 'screenshot' ? ' — auto-extracted if visible' : ''})</span></span>
            </label>
            <input id="sender-input" type="text" value={sender} onChange={(e) => setSender(e.target.value)} placeholder="e.g. +91 98XXXX2210, support@sbi-alerts.top, @recruiter_hr" autoComplete="off" className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50/90 dark:bg-slate-950/80 border border-slate-300 dark:border-slate-800 text-slate-900 dark:text-slate-100 text-sm placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-rose-500/40 focus:border-rose-500 font-mono transition-colors" />
          </div>
        )}

        {/* Message */}
        {mode === 'message' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <label htmlFor="message-input" className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-300">Message text</label>
              <div className="flex items-center gap-2">
                <button type="button" id="btn-paste-clipboard" onClick={pasteClipboard} className="text-xs text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 px-2.5 py-1.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/60 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/60 transition-colors cursor-pointer">
                  {copiedSuccess ? <Check className="w-3 h-3 text-emerald-500" aria-hidden="true" /> : <Clipboard className="w-3 h-3" aria-hidden="true" />} Paste
                </button>
                {message && <button type="button" onClick={() => setMessage('')} className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-1 cursor-pointer px-2 py-1.5"><X className="w-3 h-3" aria-hidden="true" /> Clear</button>}
              </div>
            </div>
            <textarea id="message-input" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Paste the suspicious email, text message, DM, or chat here… e.g. 'Your SBI account will be blocked today. Verify here: sbi-security-update.xyz'" className="w-full px-4 py-3 rounded-xl bg-slate-50/90 dark:bg-slate-950/80 border border-slate-300 dark:border-slate-800 text-slate-900 dark:text-slate-100 text-sm placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-rose-500/40 focus:border-rose-500 leading-relaxed font-mono resize-y transition-colors" />
          </div>
        )}

        {/* Screenshot */}
        {mode === 'screenshot' && (
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-300">Screenshot</label>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
              className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${dragOver ? 'border-rose-400 bg-rose-50/60 dark:bg-rose-500/10' : 'border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-950/60'}`}
            >
              {screenshot ? (
                <div className="flex flex-col sm:flex-row items-center gap-4">
                  <img src={screenshot.base64} alt="Uploaded screenshot preview" className="w-32 h-32 object-cover rounded-lg border border-slate-300 dark:border-slate-700" />
                  <div className="text-left flex-1 min-w-0">
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{screenshot.name}</div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">The Vision Agent will extract the message text, sender, phone/email, links, claimed organization and any payment or OTP request, then launch the relevant agents automatically.</p>
                    <button type="button" onClick={() => setScreenshot(null)} className="mt-2 text-xs text-rose-600 dark:text-rose-400 hover:underline cursor-pointer inline-flex items-center gap-1"><X className="w-3 h-3" aria-hidden="true" /> Remove</button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="w-8 h-8 mx-auto text-slate-400" aria-hidden="true" />
                  <p className="text-sm text-slate-700 dark:text-slate-300">Drag & drop a screenshot here, or</p>
                  <button type="button" id="btn-upload-screenshot" onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-slate-900 text-white dark:bg-white dark:text-slate-900 hover:opacity-90 cursor-pointer"><ImageIcon className="w-4 h-4" aria-hidden="true" /> Choose image</button>
                  <p className="text-[11px] text-slate-500">PNG, JPG or WebP · up to 8 MB{aiConfigured === false ? ' · requires Gemini for reading' : ''}</p>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => handleFile(e.target.files?.[0])} className="hidden" aria-label="Upload screenshot" />
            </div>
          </div>
        )}

        {/* URL */}
        {mode === 'url' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="url-input" className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-300">URL or domain</label>
              <div className="flex gap-2">
                <input id="url-input" type="text" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="e.g. https://sbi-security-update.xyz/verify or usps-post-redelivery.top" autoComplete="off" className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-50/90 dark:bg-slate-950/80 border border-slate-300 dark:border-slate-800 text-slate-900 dark:text-slate-100 text-sm placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-rose-500/40 focus:border-rose-500 font-mono transition-colors" />
                <button type="button" onClick={pasteClipboard} className="px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 cursor-pointer" aria-label="Paste from clipboard">{copiedSuccess ? <Check className="w-4 h-4 text-emerald-500" /> : <Clipboard className="w-4 h-4" />}</button>
              </div>
              <p className="text-[11px] text-slate-500">The link is never opened. It is parsed offline, compared with the brand registry and checked against external intelligence sources.</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="url-context" className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-300">Message it came with <span className="font-normal text-slate-500 normal-case">(optional)</span></label>
              <textarea id="url-context" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Paste the message text around the link so the Message and Identity agents have context." className="w-full px-4 py-3 rounded-xl bg-slate-50/90 dark:bg-slate-950/80 border border-slate-300 dark:border-slate-800 text-slate-900 dark:text-slate-100 text-sm placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-rose-500/40 focus:border-rose-500 font-mono resize-y transition-colors" />
            </div>
          </div>
        )}

        {/* Conversation */}
        {mode === 'conversation' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <label htmlFor="conversation-input" className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-300">Conversation transcript</label>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setConversation(SAMPLE_CONVERSATION)} className="text-xs text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 px-2.5 py-1.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/60 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/60 transition-colors cursor-pointer"><FlaskConical className="w-3 h-3" aria-hidden="true" /> Load sample</button>
                <button type="button" onClick={pasteClipboard} className="text-xs text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white flex items-center gap-1 px-2.5 py-1.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/60 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/60 transition-colors cursor-pointer">{copiedSuccess ? <Check className="w-3 h-3 text-emerald-500" aria-hidden="true" /> : <Clipboard className="w-3 h-3" aria-hidden="true" />} Paste</button>
              </div>
            </div>
            <textarea id="conversation-input" rows={8} value={conversation} onChange={(e) => setConversation(e.target.value)} placeholder={'One message per line, ideally labelled:\nScammer: Congratulations! You have been selected…\nUser: What is the salary?\nScammer: ₹4,000 per day. First pay ₹1,999 registration fee.'} className="w-full px-4 py-3 rounded-xl bg-slate-50/90 dark:bg-slate-950/80 border border-slate-300 dark:border-slate-800 text-slate-900 dark:text-slate-100 text-sm placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-rose-500/40 focus:border-rose-500 leading-relaxed font-mono resize-y transition-colors" />
            <p className="text-[11px] text-slate-500">The Conversation Agent analyses the whole exchange: progression stages, escalation pattern and the likely next ask.</p>
          </div>
        )}

        {liveWarning && (
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-600/40 text-amber-900 dark:text-amber-200 text-xs" role="status">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div><span className="font-bold">Live red-flag preview: </span>{liveWarning}</div>
          </div>
        )}

        {error && <Notice tone="error">{error}</Notice>}

        <div className="pt-1 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            <Workflow className="w-4 h-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            <span>Orchestrator picks the agents: Message · URL · Identity · Social Engineering · Financial · Threat Intel · Conversation</span>
          </div>
          <PrimaryButton type="submit" id="btn-investigate" disabled={!canRun} className="w-full sm:w-auto px-7">
            <Sparkles className="w-4 h-4" aria-hidden="true" /> Run Agentic Investigation
          </PrimaryButton>
        </div>
      </form>
    </div>
  );
};
