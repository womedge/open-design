// @vitest-environment jsdom
//
// The watchdog is an inline script string, so the spec evaluates it the way
// the browser would and drives it with virtual time.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SHELL_WATCHDOG_SCRIPT } from '../../src/runtime/shell-watchdog';

const MARK = 'data-od-app-mounted';
const KEY = 'od-shell-reload-at';
let reload: ReturnType<typeof vi.fn>;
let store: Map<string, string>;

function boot(): void {
  new Function(SHELL_WATCHDOG_SCRIPT)();
}

function chunkError(tag: 'script' | 'link', url: string): void {
  const el = document.createElement(tag);
  if (tag === 'script') (el as HTMLScriptElement).src = url;
  else (el as HTMLLinkElement).href = url;
  document.head.appendChild(el);
  el.dispatchEvent(new Event('error')); // resource errors do not bubble
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  reload = vi.fn();
  store = new Map();
  vi.stubGlobal('location', { reload });
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  document.documentElement.removeAttribute(MARK);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.head.innerHTML = '';
});

describe('shell watchdog', () => {
  it('reloads once if the app has not mounted 15s after load', () => {
    boot();
    vi.advanceTimersByTime(14_999);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(store.get(KEY)).toBe('1015000');
  });

  it('does nothing once the app has mounted', () => {
    boot();
    document.documentElement.setAttribute(MARK, '1');
    vi.advanceTimersByTime(60_000);
    chunkError('script', '/_next/static/chunks/a.js');
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads right away when a /_next/ script or stylesheet fails', () => {
    boot();
    chunkError('script', '/_next/static/chunks/a.js');
    expect(reload).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('ignores failures of unrelated resources', () => {
    boot();
    chunkError('script', 'https://cdn.example.com/x.js');
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload again within 60s of a previous reload', () => {
    store.set(KEY, String(1_000_000 - 59_000));
    boot();
    chunkError('link', '/_next/static/css/a.css');
    vi.advanceTimersByTime(15_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads again once the 60s guard has expired', () => {
    store.set(KEY, String(1_000_000 - 61_000));
    boot();
    chunkError('link', '/_next/static/css/a.css');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('never reloads when sessionStorage is unavailable', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('denied');
      },
    });
    boot();
    vi.advanceTimersByTime(15_000);
    expect(reload).not.toHaveBeenCalled();
  });
});
