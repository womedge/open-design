import { VisuallyHidden } from '@open-design/components';

import { useT } from '../../i18n';
import type { UsageProjectLabel } from './usage-project-labels';
import styles from './ProjectName.module.css';

/** A project's name; deleted ones are struck through with a hidden spoken hint. */
export function ProjectName({ label }: { label: UsageProjectLabel }) {
  const t = useT();
  if (!label.deleted || label.nameless) return <>{label.text}</>;
  return (
    <>
      <span className={styles.struck} data-testid="usage-project-struck">{label.text}</span>
      <VisuallyHidden>{t('usage.deletedHint')}</VisuallyHidden>
    </>
  );
}
