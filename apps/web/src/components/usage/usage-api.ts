import type { UsageQuery, UsageSummaryResponse } from '@open-design/contracts';

export function usageQueryString(query: UsageQuery): string {
  const params = new URLSearchParams();
  params.set('from', query.from);
  params.set('to', query.to);
  const optional: Array<[string, string | undefined]> = [
    ['compareFrom', query.compareFrom],
    ['compareTo', query.compareTo],
    ['projectId', query.projectId],
    ['user', query.user],
    ['agentId', query.agentId],
    ['model', query.model],
  ];
  for (const [key, value] of optional) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

export async function fetchUsageSummary(
  query: UsageQuery,
  signal?: AbortSignal,
): Promise<UsageSummaryResponse> {
  const init: RequestInit = signal ? { signal } : {};
  const res = await fetch(`/api/usage/summary?${usageQueryString(query)}`, init);
  if (!res.ok) throw new Error(`usage summary ${res.status}`);
  return (await res.json()) as UsageSummaryResponse;
}

/** Downloads the filtered CSV. The comparison period never applies to exports. */
export async function downloadUsageExport(query: UsageQuery): Promise<void> {
  const { compareFrom: _f, compareTo: _t, ...rest } = query;
  const res = await fetch(`/api/usage/export?${usageQueryString(rest)}`);
  if (!res.ok) throw new Error(`usage export ${res.status}`);
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
  const filename = named ? decodeURIComponent(named) : `usage-${query.from}_${query.to}.csv`;
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
