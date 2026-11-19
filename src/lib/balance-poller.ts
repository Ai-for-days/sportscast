// One shared balance poller per page (WOW-034).
//
// The header's UserMenu and the betting sidebar each polled
// /api/account/balance every 5 seconds, visible or not: two polls per tab
// every 5 s, three Redis commands each, about 4,300 billed commands an hour
// for every logged-in tab left open. They now share this one poller:
//
// - one request every 60 s while the tab is visible, however many
//   components on the page show the balance;
// - nothing while the tab is hidden, and one refetch the moment it is
//   visible again;
// - refresh() right after a bet is placed (and on the `wow:balance-changed`
//   window event, for anything else that moves the balance), so the number
//   never looks stale after an action.
//
// The islands on a page are separate React roots, so this is a module-level
// singleton (kept on window), not a React context.

export const BALANCE_POLL_MS = 60_000;
export const BALANCE_CHANGED_EVENT = 'wow:balance-changed';

export type BalanceStatus = 'idle' | 'ok' | 'unauthenticated' | 'error';

export interface BalanceState {
  /** Dollars, or null until the first successful read. */
  balanceDollars: number | null;
  status: BalanceStatus;
  /** A request is in flight. */
  loading: boolean;
  /** Increments once per completed request, so listeners can react to each result. */
  seq: number;
}

export type BalanceListener = (s: BalanceState) => void;

/** What the poller needs from the browser. Injected so tests run without one. */
export interface BalanceEnv {
  fetch: (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
  isHidden: () => boolean;
  onVisibilityChange: (fn: () => void) => () => void;
  onBalanceChanged: (fn: () => void) => () => void;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (h: unknown) => void;
}

export interface BalancePoller {
  subscribe(fn: BalanceListener): () => void;
  /** Fetch now (deduplicated with a request already in flight). */
  refresh(): Promise<void>;
  /** Publish a balance the server already returned (e.g. a bet's newBalance). */
  setBalance(dollars: number): void;
  getState(): BalanceState;
}

export function createBalancePoller(env: BalanceEnv, intervalMs = BALANCE_POLL_MS): BalancePoller {
  let state: BalanceState = { balanceDollars: null, status: 'idle', loading: false, seq: 0 };
  const listeners = new Set<BalanceListener>();
  let timer: unknown = null;
  let inFlight: Promise<void> | null = null;
  let detach: (() => void)[] = [];

  const emit = (patch: Partial<BalanceState>) => {
    state = { ...state, ...patch };
    for (const l of listeners) l(state);
  };

  const refresh = (): Promise<void> => {
    if (inFlight) return inFlight;
    emit({ loading: true });
    inFlight = (async () => {
      try {
        const res = await env.fetch('/api/account/balance');
        if (res.ok) {
          const data = await res.json();
          emit({ balanceDollars: data.balanceDollars, status: 'ok', loading: false, seq: state.seq + 1 });
        } else {
          emit({ status: res.status === 401 ? 'unauthenticated' : 'error', loading: false, seq: state.seq + 1 });
        }
      } catch (err) {
        console.error('Balance fetch error:', err);
        emit({ status: 'error', loading: false, seq: state.seq + 1 });
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  const startTimer = () => {
    if (timer === null) timer = env.setInterval(() => { void refresh(); }, intervalMs);
  };
  const stopTimer = () => {
    if (timer !== null) env.clearInterval(timer);
    timer = null;
  };

  const onVisibility = () => {
    if (env.isHidden()) {
      stopTimer();
    } else {
      void refresh();
      startTimer();
    }
  };

  const start = () => {
    detach = [env.onVisibilityChange(onVisibility), env.onBalanceChanged(() => { void refresh(); })];
    if (!env.isHidden()) {
      void refresh();
      startTimer();
    }
  };
  const stop = () => {
    stopTimer();
    for (const d of detach) d();
    detach = [];
  };

  return {
    subscribe(fn) {
      listeners.add(fn);
      if (listeners.size === 1) start();
      else fn(state);
      return () => {
        listeners.delete(fn);
        if (listeners.size === 0) stop();
      };
    },
    refresh,
    setBalance(dollars) {
      emit({ balanceDollars: dollars, status: 'ok' });
    },
    getState: () => state,
  };
}

function browserEnv(): BalanceEnv {
  return {
    fetch: (url) => fetch(url),
    isHidden: () => typeof document !== 'undefined' && document.hidden,
    onVisibilityChange: (fn) => {
      document.addEventListener('visibilitychange', fn);
      return () => document.removeEventListener('visibilitychange', fn);
    },
    onBalanceChanged: (fn) => {
      window.addEventListener(BALANCE_CHANGED_EVENT, fn);
      return () => window.removeEventListener(BALANCE_CHANGED_EVENT, fn);
    },
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (h) => window.clearInterval(h as number),
  };
}

/** The page's one poller. Shared across islands through window. */
export function getBalancePoller(): BalancePoller {
  const w = window as unknown as { __wowBalancePoller?: BalancePoller };
  if (!w.__wowBalancePoller) w.__wowBalancePoller = createBalancePoller(browserEnv());
  return w.__wowBalancePoller;
}

/** Tell every balance display on the page to refetch now (after a bet, a settlement, a deposit). */
export function notifyBalanceChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(BALANCE_CHANGED_EVENT));
}
