/**
 * Build-time switch for self-hosted deployments that never use OpenDesign
 * Cloud or its community channels. When `NEXT_PUBLIC_OD_HIDE_CLOUD_PROMO=1`
 * is set during `next build`, these are not rendered: the "sign up for free
 * credits" callouts and onboarding Cloud sign-in, the official Cloud (`amr`)
 * agent card, the message center and What's New popup, campaign badges, the
 * Discord / X / support-mail row, and the GitHub star chip (and its lookup).
 * Unset (the default) keeps the stock behavior.
 */
export const HIDE_CLOUD_PROMO = process.env.NEXT_PUBLIC_OD_HIDE_CLOUD_PROMO === '1';
