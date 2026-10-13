// Fill missing Traditional Chinese (zh-TW) entries from Simplified Chinese
// (zh-CN) in localized skill / plugin metadata, so a zh-TW UI shows
// Traditional text instead of falling back to Simplified (skills) or English
// (plugins). Existing zh-TW values are never overwritten.
import * as OpenCC from 'opencc-js/cn2t';

// Post-OpenCC wording fixes for Taiwan usage; keep in sync with the rules
// used to generate apps/web/src/i18n/content.zh-TW.ts.
const TAIWAN_WORDING_FIXES: ReadonlyArray<readonly [string, string]> = [
  ['臺', '台'],
  ['分割槽', '分區'],
  ['質量', '品質'],
  ['實時', '即時'],
  ['當前', '目前'],
  ['最佳化', '優化'],
  ['“', '「'],
  ['”', '」'],
];

let cachedConverter: ((text: string) => string) | undefined;

export function toTaiwanTraditional(text: string): string {
  const convert = (cachedConverter ??= OpenCC.Converter({ from: 'cn', to: 'twp' }));
  let out = convert(text);
  for (const [from, to] of TAIWAN_WORDING_FIXES) out = out.replaceAll(from, to);
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Return `map` with `zh-TW` derived from `zh-CN` when only the latter exists. */
export function withZhTw<T extends Record<string, string> | undefined>(map: T): T {
  if (!map || map['zh-TW'] || !map['zh-CN']) return map;
  return { ...map, 'zh-TW': toTaiwanTraditional(map['zh-CN']) };
}

/**
 * Response-only view of a plugin record with zh-TW filled into a cloned
 * manifest. Never mutate the registered manifest itself: plan snapshots and
 * strategy package hashes are computed from it.
 */
export function withZhTwManifest<T extends { manifest?: unknown }>(record: T): T {
  if (!record || !isPlainObject(record.manifest)) return record;
  const manifest = structuredClone(record.manifest);
  fillZhTwDeep(manifest);
  return { ...record, manifest };
}

type SkillLocaleFields = {
  displayName?: Record<string, string>;
  descriptionI18n?: Record<string, string>;
  examplePromptI18n?: Record<string, string>;
};

/**
 * Response-only view of a skill / design template with zh-TW filled into its
 * localized name, description, and example prompt. Like `withZhTwManifest`,
 * this never touches the loaded skill, which feeds plan snapshots.
 */
export function withZhTwSkill<T extends SkillLocaleFields>(skill: T): T {
  return {
    ...skill,
    ...(skill.displayName ? { displayName: withZhTw(skill.displayName) } : {}),
    ...(skill.descriptionI18n ? { descriptionI18n: withZhTw(skill.descriptionI18n) } : {}),
    ...(skill.examplePromptI18n ? { examplePromptI18n: withZhTw(skill.examplePromptI18n) } : {}),
  };
}

/** `withZhTwManifest` over a plugin list; non-arrays pass through unchanged. */
export function withZhTwManifests(records: unknown): unknown {
  if (!Array.isArray(records)) return records;
  return records.map((record) => (isPlainObject(record) ? withZhTwManifest(record) : record));
}

/** Recursively add `zh-TW` to every `{ "zh-CN": string }` locale map in place. */
export function fillZhTwDeep(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) fillZhTwDeep(item);
    return;
  }
  if (!isPlainObject(value)) return;
  const zhCn = value['zh-CN'];
  if (typeof zhCn === 'string' && zhCn.trim() && !('zh-TW' in value)) {
    value['zh-TW'] = toTaiwanTraditional(zhCn);
  }
  for (const child of Object.values(value)) fillZhTwDeep(child);
}
