import { describe, expect, it } from 'vitest';

import {
  cloudflarePagesSelectionFor,
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

  it('deploy request carries the suffixed prefix, matching the dialog preview', () => {
    const zone = { id: 'z1', name: 'womedge.com' };
    expect(cloudflarePagesSelectionFor(zone, 'dentsu', 'od')).toEqual({
      zoneId: 'z1',
      zoneName: 'womedge.com',
      domainPrefix: 'dentsu.od',
    });
    expect(cloudflarePagesSelectionFor(zone, 'dentsu', '').domainPrefix).toBe('dentsu');
  });
});
