import { useCallback, useState } from 'react';

/**
 * Open/closed state of the page's disclosure widgets. It lives outside the
 * components so that anything that remounts the page (a parent re-keyed by the
 * app shell, a route re-entry) does not collapse what the user just opened.
 * Data refetches never touch it.
 */
interface UsageUiState {
  projectsExpanded: boolean;
  detailOpen: boolean;
  openUser: string | null;
}

const initial = (): UsageUiState => ({ projectsExpanded: false, detailOpen: false, openUser: null });
let state: UsageUiState = initial();

export function resetUsageUiState(): void {
  state = initial();
}

export function useUsageUiState<K extends keyof UsageUiState>(
  key: K,
): [UsageUiState[K], (next: UsageUiState[K] | ((prev: UsageUiState[K]) => UsageUiState[K])) => void] {
  const [value, setValue] = useState<UsageUiState[K]>(() => state[key]);
  const set = useCallback(
    (next: UsageUiState[K] | ((prev: UsageUiState[K]) => UsageUiState[K])) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: UsageUiState[K]) => UsageUiState[K])(prev) : next;
        state[key] = resolved;
        return resolved;
      });
    },
    [key],
  );
  return [value, set];
}
