/**
 * Build-time product branding for self-hosted deployments.
 *
 * When `NEXT_PUBLIC_OD_BRAND_NAME` is set during `next build` (e.g. "AWP+"),
 * the product is presented as that name with "OpenDesign" as its subtitle:
 * the document title, the sidebar lockup, the loading shell, the favicon,
 * and every UI string that names the product (see applyBrand). Unset (the
 * default) keeps the stock OpenDesign branding.
 */
export const BRAND_NAME = (process.env.NEXT_PUBLIC_OD_BRAND_NAME ?? '').trim();

/** The product name shown to users: the configured brand, else "OpenDesign". */
export const PRODUCT_NAME = BRAND_NAME || 'OpenDesign';

export const DOCUMENT_TITLE = BRAND_NAME ? `${BRAND_NAME} · OpenDesign` : 'OpenDesign';

/** Favicon for branded builds: the lockup mark (public/brand-mark.svg). */
export const FAVICON = BRAND_NAME ? '/brand-mark.svg' : '/app-icon.png';

/**
 * Fixed sub-label the Cloudflare Pages deploy dialog appends to the typed
 * name (`pantene` -> `pantene.od.<zone>`). Empty in stock builds.
 */
export const DEPLOY_SUBDOMAIN_SUFFIX = BRAND_NAME ? 'od' : '';

/**
 * Mentions that refer to the upstream OpenDesign project or its hosted
 * service rather than to this product. They keep the original name.
 */
const UPSTREAM_MENTION = /Open ?Design(?=\s*(?:Cloud|團隊|团队|team|Team|官網|官网))|GitHub 上的 OpenDesign|OpenDesign on GitHub/;

const PRODUCT_MENTION = /Open ?Design/g;

export function applyBrand(_key: string, text: string): string {
  if (!BRAND_NAME || !text.includes('Design')) return text;
  // Split on upstream mentions so only product mentions are renamed.
  const parts = text.split(new RegExp(`(${UPSTREAM_MENTION.source})`));
  return parts
    .map((part, i) => (i % 2 === 1 ? part : part.replace(PRODUCT_MENTION, BRAND_NAME)))
    .join('');
}
