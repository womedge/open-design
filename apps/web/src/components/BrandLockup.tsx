import { BRAND_NAME } from '../utils/brand';
import styles from './BrandLockup.module.css';

/**
 * Two-line product lockup for branded self-hosted builds: the configured
 * brand name large on top, "OpenDesign" small underneath. Renders nothing
 * unless NEXT_PUBLIC_OD_BRAND_NAME was set at build time.
 */
export function BrandLockup() {
  if (!BRAND_NAME) return null;
  const plus = BRAND_NAME.endsWith('+');
  const base = plus ? BRAND_NAME.slice(0, -1) : BRAND_NAME;
  return (
    <div className={styles.lockup} role="img" aria-label={`${BRAND_NAME} OpenDesign`}>
      <span className={styles.mark} aria-hidden />
      <span className={styles.text} aria-hidden>
        <span className={styles.name}>
          {base}
          {plus ? <span className={styles.plus}>+</span> : null}
        </span>
        <span className={styles.sub}>OpenDesign</span>
      </span>
    </div>
  );
}
