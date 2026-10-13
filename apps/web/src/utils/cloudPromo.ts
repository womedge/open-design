/**
 * Build-time switch for self-hosted deployments that never use OpenDesign
 * Cloud. When `NEXT_PUBLIC_OD_HIDE_CLOUD_PROMO=1` is set during `next build`,
 * the "sign up for free credits" callouts and the onboarding Cloud sign-in
 * button are not rendered. Unset (the default) keeps the stock behavior.
 */
export const HIDE_CLOUD_PROMO = process.env.NEXT_PUBLIC_OD_HIDE_CLOUD_PROMO === '1';
