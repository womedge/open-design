/**
 * Build-time product branding for self-hosted deployments.
 *
 * When `NEXT_PUBLIC_OD_BRAND_NAME` is set during `next build` (e.g. "AWP+"),
 * the product is presented as that name with "OpenDesign" as its subtitle:
 * the document title, the sidebar lockup, and the strings listed in
 * BRANDED_KEYS. Unset (the default) keeps the stock OpenDesign branding.
 */
export const BRAND_NAME = (process.env.NEXT_PUBLIC_OD_BRAND_NAME ?? '').trim();

export const DOCUMENT_TITLE = BRAND_NAME ? `${BRAND_NAME} · OpenDesign` : 'OpenDesign';

/** i18n keys that name the product itself, rather than describing OpenDesign. */
export const BRANDED_KEYS: ReadonlySet<string> = new Set([
  'app.brand',
  'settings.welcomeTitle',
  'settings.onboardingCloudTitle',
]);

export function applyBrand(key: string, text: string): string {
  if (!BRAND_NAME || !BRANDED_KEYS.has(key)) return text;
  return text.replaceAll('OpenDesign', BRAND_NAME);
}
