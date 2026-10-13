import { describe, expect, it } from 'vitest';

import {
  fillZhTwDeep,
  toTaiwanTraditional,
  withZhTw,
  withZhTwManifest,
  withZhTwSkill,
} from '../src/zh-tw-fill.js';

describe('zh-TW fill from zh-CN', () => {
  it('converts to Taiwan Traditional with local wording fixes', () => {
    expect(toTaiwanTraditional('从参考网站提取视觉特效')).toBe('從參考網站提取視覺特效');
    expect(toTaiwanTraditional('这台电脑的平台')).toBe('這台電腦的平台');
    expect(toTaiwanTraditional('优化当前设计')).toBe('優化目前設計');
  });

  it('adds zh-TW only when missing', () => {
    expect(withZhTw({ en: 'Magazine', 'zh-CN': '杂志文章' })).toEqual({
      en: 'Magazine',
      'zh-CN': '杂志文章',
      'zh-TW': '雜誌文章',
    });
    const existing = { 'zh-CN': '杂志', 'zh-TW': '自訂譯名' };
    expect(withZhTw(existing)).toBe(existing);
    expect(withZhTw({ en: 'Only English' })).toEqual({ en: 'Only English' });
    expect(withZhTw(undefined)).toBeUndefined();
  });

  it('fills nested locale maps in a manifest without touching existing zh-TW', () => {
    const manifest = {
      title_i18n: { en: 'Web effect extractor', 'zh-CN': '网页特效提取' },
      description_i18n: { 'zh-CN': '复刻', 'zh-TW': '原有繁體' },
      od: { useCase: { query: { 'zh-CN': '提取网页视觉特效' } } },
      tags: ['a', { 'zh-CN': '标签' }],
    };
    fillZhTwDeep(manifest);
    expect(manifest.title_i18n).toMatchObject({ 'zh-TW': '網頁特效提取' });
    expect(manifest.description_i18n['zh-TW']).toBe('原有繁體');
    expect(manifest.od.useCase.query).toMatchObject({ 'zh-TW': '提取網頁視覺特效' });
    expect(manifest.tags[1]).toMatchObject({ 'zh-TW': '標籤' });
  });

  it('fills a cloned manifest for responses and leaves the registered one untouched', () => {
    const record = { id: 'p', manifest: { title_i18n: { en: 'Extractor', 'zh-CN': '网页特效提取' } } };
    const view = withZhTwManifest(record);
    expect(view.manifest.title_i18n).toMatchObject({ 'zh-TW': '網頁特效提取' });
    expect(record.manifest.title_i18n).not.toHaveProperty('zh-TW');
    expect(view).not.toBe(record);
  });

  it('fills skill name, description, and prompt for responses without mutating the skill', () => {
    type Skill = {
      id: string;
      displayName?: Record<string, string>;
      descriptionI18n?: Record<string, string>;
      examplePromptI18n?: Record<string, string>;
    };
    const skill: Skill = {
      id: 'article-magazine',
      displayName: { en: 'Magazine Article', 'zh-CN': '杂志文章' },
      descriptionI18n: { 'zh-CN': '精排长文' },
      examplePromptI18n: { 'zh-CN': '用模板做成长文', 'zh-TW': '既有提示' },
    };
    const view = withZhTwSkill(skill);
    expect(view.displayName?.['zh-TW']).toBe('雜誌文章');
    expect(view.descriptionI18n?.['zh-TW']).toBe('精排長文');
    expect(view.examplePromptI18n?.['zh-TW']).toBe('既有提示');
    expect(skill.displayName).not.toHaveProperty('zh-TW');
    const plain: Skill = { id: 'plain' };
    expect(withZhTwSkill(plain)).toEqual({ id: 'plain' });
  });
});
