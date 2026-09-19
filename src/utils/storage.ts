import { AnalysisResult, CoachProgress } from '../types';

const HISTORY_KEY = 'online_safety_guard_history_v1';
const COACH_KEY = 'online_safety_guard_coach_v1';

export function getScanHistory(): AnalysisResult[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to load history', e);
    return [];
  }
}

export function saveScanToHistory(scan: AnalysisResult): void {
  try {
    const history = getScanHistory();
    const updated = [scan, ...history.filter(item => item.id !== scan.id)].slice(0, 30);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error('Failed to save to history', e);
  }
}

export function clearScanHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch (e) {
    console.error('Failed to clear history', e);
  }
}

// ---------------------------------------------------------------------------
// Safety Coach progress (adaptive difficulty + weak-area tracking)
// ---------------------------------------------------------------------------

export function emptyCoachProgress(): CoachProgress {
  return { answered: 0, correct: 0, streak: 0, byCategory: {}, recentMistakes: [], difficulty: 1 };
}

export function getCoachProgress(): CoachProgress {
  try {
    const raw = localStorage.getItem(COACH_KEY);
    return raw ? { ...emptyCoachProgress(), ...(JSON.parse(raw) as CoachProgress) } : emptyCoachProgress();
  } catch {
    return emptyCoachProgress();
  }
}

export function saveCoachProgress(progress: CoachProgress): void {
  try {
    localStorage.setItem(COACH_KEY, JSON.stringify(progress));
  } catch (e) {
    console.error('Failed to save coach progress', e);
  }
}

export function resetCoachProgress(): void {
  try {
    localStorage.removeItem(COACH_KEY);
  } catch {
    /* ignore */
  }
}
