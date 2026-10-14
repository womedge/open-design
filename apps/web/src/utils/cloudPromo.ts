/**
 * Build-time switch for self-hosted deployments that never use OpenDesign
 * Cloud or its community channels. When `NEXT_PUBLIC_OD_HIDE_CLOUD_PROMO=1`
 * is set during `next build`, these are not rendered: the "sign up for free
 * credits" callouts and onboarding Cloud sign-in, the official Cloud (`amr`)
 * agent card, the message center and What's New popup, campaign badges, the
 * Discord / X / support-mail row, the GitHub star chip (and its lookup), and
 * the FileViewer "open in editor / file manager" handoff button (it acts on the
 * server host, which is useless in a hosted deployment), and the run-error
 * card's "switch to OpenDesign Cloud" CTA and "export logs" action (the
 * diagnostics zip is server-wide, so it would expose other users' data). The card's "contact us" action opens
 * a mail to the internal admin (`adminContactMailto`) instead of the official
 * support channels dialog.
 * Unset (the default) keeps the stock behavior.
 */
export const HIDE_CLOUD_PROMO = process.env.NEXT_PUBLIC_OD_HIDE_CLOUD_PROMO === '1';

/** Internal admin mailbox used in place of the official support channels. */
export const ADMIN_CONTACT_EMAIL = 'sam@womedge.com';

/** `mailto:` link to the internal admin; the subject is URL-encoded. */
export function adminContactMailto(subject = 'AWP+ 任務失敗'): string {
  return `mailto:${ADMIN_CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}
