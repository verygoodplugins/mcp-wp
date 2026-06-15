import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SiteManager } from '../../src/config/site-manager.js';

const WP_KEYS: string[] = [
  'WORDPRESS_API_URL',
  'WORDPRESS_USERNAME',
  'WORDPRESS_PASSWORD',
];
for (let i = 1; i <= 10; i++) {
  WP_KEYS.push(
    `WORDPRESS_${i}_URL`,
    `WORDPRESS_${i}_USERNAME`,
    `WORDPRESS_${i}_PASSWORD`,
    `WORDPRESS_${i}_ID`,
    `WORDPRESS_${i}_ALIASES`,
    `WORDPRESS_${i}_DEFAULT`,
  );
}

let envBackup: Record<string, string | undefined>;

beforeEach(() => {
  envBackup = {};
  for (const key of WP_KEYS) {
    envBackup[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of WP_KEYS) {
    const original = envBackup[key];
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
});

describe('SiteManager environment loading', () => {
  it('throws a helpful error when no configuration is set', () => {
    const sm = new SiteManager();
    expect(() => sm.getAllSites()).toThrow(/No WordPress configuration/);
  });

  it('loads a single numbered site and makes it the default', () => {
    process.env.WORDPRESS_1_URL = 'https://one.test';
    process.env.WORDPRESS_1_USERNAME = 'admin';
    process.env.WORDPRESS_1_PASSWORD = 'pw';

    const sm = new SiteManager();
    const sites = sm.getAllSites();

    expect(sites).toHaveLength(1);
    expect(sites[0].id).toBe('site1');
    expect(sites[0].url).toBe('https://one.test');
    expect(sm.getDefaultSiteId()).toBe('site1');
  });

  it('uses WORDPRESS_N_ID when provided', () => {
    process.env.WORDPRESS_1_URL = 'https://prod.test';
    process.env.WORDPRESS_1_USERNAME = 'admin';
    process.env.WORDPRESS_1_PASSWORD = 'pw';
    process.env.WORDPRESS_1_ID = 'production';

    const sm = new SiteManager();
    expect(sm.getDefaultSiteId()).toBe('production');
    expect(sm.getSite('production').url).toBe('https://prod.test');
  });

  it('respects WORDPRESS_N_DEFAULT=true to override the first-site default', () => {
    process.env.WORDPRESS_1_URL = 'https://prod.test';
    process.env.WORDPRESS_1_USERNAME = 'admin';
    process.env.WORDPRESS_1_PASSWORD = 'pw';
    process.env.WORDPRESS_1_ID = 'production';

    process.env.WORDPRESS_2_URL = 'https://staging.test';
    process.env.WORDPRESS_2_USERNAME = 'admin';
    process.env.WORDPRESS_2_PASSWORD = 'pw';
    process.env.WORDPRESS_2_ID = 'staging';
    process.env.WORDPRESS_2_DEFAULT = 'true';

    const sm = new SiteManager();
    expect(sm.getDefaultSiteId()).toBe('staging');
  });

  it('parses comma-separated aliases with whitespace trimming', () => {
    process.env.WORDPRESS_1_URL = 'https://one.test';
    process.env.WORDPRESS_1_USERNAME = 'admin';
    process.env.WORDPRESS_1_PASSWORD = 'pw';
    process.env.WORDPRESS_1_ALIASES = 'prod, main, primary';

    const sm = new SiteManager();
    expect(sm.getSite('site1').aliases).toEqual(['prod', 'main', 'primary']);
  });

  it('falls back to legacy single-site variables when no numbered sites exist', () => {
    process.env.WORDPRESS_API_URL = 'https://legacy.test';
    process.env.WORDPRESS_USERNAME = 'admin';
    process.env.WORDPRESS_PASSWORD = 'pw';

    const sm = new SiteManager();
    const sites = sm.getAllSites();

    expect(sites).toHaveLength(1);
    expect(sites[0].id).toBe('default');
    expect(sm.getDefaultSiteId()).toBe('default');
  });

  it('prefers numbered sites over legacy variables when both are present', () => {
    process.env.WORDPRESS_1_URL = 'https://numbered.test';
    process.env.WORDPRESS_1_USERNAME = 'admin';
    process.env.WORDPRESS_1_PASSWORD = 'pw';

    process.env.WORDPRESS_API_URL = 'https://legacy.test';
    process.env.WORDPRESS_USERNAME = 'admin';
    process.env.WORDPRESS_PASSWORD = 'pw';

    const sm = new SiteManager();
    const sites = sm.getAllSites();

    expect(sites).toHaveLength(1);
    expect(sites[0].id).toBe('site1');
  });

  it('skips numbered slots that are missing any required field', () => {
    process.env.WORDPRESS_1_URL = 'https://one.test';
    process.env.WORDPRESS_1_USERNAME = 'admin';
    // password missing — slot 1 should be skipped

    process.env.WORDPRESS_2_URL = 'https://two.test';
    process.env.WORDPRESS_2_USERNAME = 'admin';
    process.env.WORDPRESS_2_PASSWORD = 'pw';

    const sm = new SiteManager();
    const sites = sm.getAllSites();

    expect(sites.map((s) => s.url)).toEqual(['https://two.test']);
  });
});

describe('SiteManager.getSite', () => {
  beforeEach(() => {
    process.env.WORDPRESS_1_URL = 'https://prod.test';
    process.env.WORDPRESS_1_USERNAME = 'admin';
    process.env.WORDPRESS_1_PASSWORD = 'pw';
    process.env.WORDPRESS_1_ID = 'production';

    process.env.WORDPRESS_2_URL = 'https://staging.test';
    process.env.WORDPRESS_2_USERNAME = 'admin';
    process.env.WORDPRESS_2_PASSWORD = 'pw';
    process.env.WORDPRESS_2_ID = 'staging';
  });

  it('returns the default site when called with no id', () => {
    const sm = new SiteManager();
    expect(sm.getSite().id).toBe('production');
  });

  it('returns the named site when given an id', () => {
    const sm = new SiteManager();
    expect(sm.getSite('staging').id).toBe('staging');
  });

  it('throws a helpful error for unknown ids', () => {
    const sm = new SiteManager();
    expect(() => sm.getSite('nope')).toThrow(/not found/);
    expect(() => sm.getSite('nope')).toThrow(/production/);
    expect(() => sm.getSite('nope')).toThrow(/staging/);
  });
});

describe('SiteManager.detectSiteFromContext', () => {
  beforeEach(() => {
    process.env.WORDPRESS_1_URL = 'https://example.com';
    process.env.WORDPRESS_1_USERNAME = 'admin';
    process.env.WORDPRESS_1_PASSWORD = 'pw';
    process.env.WORDPRESS_1_ID = 'production';
    process.env.WORDPRESS_1_ALIASES = 'prod,main';

    process.env.WORDPRESS_2_URL = 'https://staging.example.org';
    process.env.WORDPRESS_2_USERNAME = 'admin';
    process.env.WORDPRESS_2_PASSWORD = 'pw';
    process.env.WORDPRESS_2_ID = 'staging';
  });

  it('detects a site by hostname mentioned in the request', () => {
    const sm = new SiteManager();
    expect(sm.detectSiteFromContext('Please update https://example.com/about')).toBe(
      'production',
    );
  });

  it('detects a site by alias mention', () => {
    const sm = new SiteManager();
    expect(sm.detectSiteFromContext('Publish on prod')).toBe('production');
  });

  it('detects a site by id mention', () => {
    const sm = new SiteManager();
    expect(sm.detectSiteFromContext('Run this on staging')).toBe('staging');
  });

  it('matches case-insensitively', () => {
    const sm = new SiteManager();
    expect(sm.detectSiteFromContext('Push to PROD now')).toBe('production');
  });

  it('returns null when nothing matches', () => {
    const sm = new SiteManager();
    expect(sm.detectSiteFromContext('Just some unrelated text')).toBeNull();
  });

  it('returns null for empty input', () => {
    const sm = new SiteManager();
    expect(sm.detectSiteFromContext('')).toBeNull();
  });
});
