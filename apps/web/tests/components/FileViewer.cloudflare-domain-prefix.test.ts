import { describe, expect, it } from 'vitest';

import {
  cloudflarePrefixForDeploy,
  cloudflarePrefixFromSaved,
  isValidCloudflareDomainPrefixInput,
} from '../../src/components/FileViewer';

describe('Cloudflare custom-domain prefix input', () => {
  it('accepts a single label and rejects dots', () => {
    expect(isValidCloudflareDomainPrefixInput('pantene')).toBe(true);
    expect(isValidCloudflareDomainPrefixInput('pantene.od')).toBe(false);
  });

  it('branded: appends the fixed suffix and strips it from the saved value', () => {
    expect(cloudflarePrefixForDeploy('pantene', 'od')).toBe('pantene.od');
    expect(cloudflarePrefixFromSaved('pantene.od', 'od')).toBe('pantene');
    expect(cloudflarePrefixFromSaved('pantene', 'od')).toBe('pantene');
  });

  it('unbranded (empty suffix): upstream behavior', () => {
    expect(cloudflarePrefixForDeploy('pantene', '')).toBe('pantene');
    expect(cloudflarePrefixFromSaved('pantene.od', '')).toBe('pantene.od');
  });
});
