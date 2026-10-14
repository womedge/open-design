import { describe, expect, it } from 'vitest';

import {
  cloudflareDefaultName,
  cloudflareNameFromHostname,
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

  it('branded: recovers the bare name from a previous deployment hostname', () => {
    expect(cloudflareNameFromHostname('dentsu.od.womedge.com', 'womedge.com', 'od')).toBe('dentsu');
    expect(cloudflareNameFromHostname('dentsu.womedge.com', 'womedge.com', 'od')).toBeNull();
    expect(cloudflareNameFromHostname('dentsu.od.other.com', 'womedge.com', 'od')).toBeNull();
    expect(cloudflareNameFromHostname(undefined, 'womedge.com', 'od')).toBeNull();
    expect(cloudflareNameFromHostname('dentsu.od.womedge.com', 'womedge.com', '')).toBeNull();
  });

  it('branded: default name is the first 8 chars of the project id, lowercased', () => {
    expect(cloudflareDefaultName('8DA2BA36-b02d-4c1e-9f00-123456789abc')).toBe('8da2ba36');
  });
});
