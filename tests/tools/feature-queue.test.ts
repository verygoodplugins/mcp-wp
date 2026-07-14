import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({
  default: {
    request: vi.fn(),
  },
}));

vi.mock('../../src/config/site-manager.js', () => ({
  siteManager: {
    getSite: vi.fn(),
  },
}));

import axios from 'axios';
import { siteManager } from '../../src/config/site-manager.js';
import { featureQueueHandlers, featureQueueTools } from '../../src/tools/feature-queue.js';

const mockedRequest = vi.mocked(axios.request);
const mockedGetSite = vi.mocked(siteManager.getSite);
const queueItem = {
  id: 42,
  status: 'queued',
  rank: 3,
  run_id: null,
  claimed_at: null,
  pr_url: null,
  last_error: null,
};

describe('WP Fusion feature queue tools', () => {
  beforeEach(() => {
    mockedRequest.mockReset();
    mockedGetSite.mockReset();
    mockedGetSite.mockReturnValue({
      id: 'production',
      url: 'https://wpfusion.test/',
      username: 'agent',
      password: 'application-password',
      aliases: [],
      isDefault: false,
    });
    mockedRequest.mockResolvedValue({ data: { item: queueItem } });
  });

  it('registers the four queue operations with required site ids', () => {
    expect(featureQueueTools.map((tool) => tool.name)).toEqual([
      'list_wpf_feature_queue',
      'enqueue_wpf_feature',
      'claim_next_wpf_feature',
      'transition_wpf_feature',
    ]);

    for (const tool of featureQueueTools) {
      const properties = tool.inputSchema.properties as Record<string, { isOptional(): boolean }>;
      expect(properties.site_id.isOptional(), `${tool.name} site_id`).toBe(false);
    }
  });

  it('lists queue items and optional stale claims', async () => {
    mockedRequest.mockResolvedValueOnce({
      data: { items: [queueItem], stale_claims: [] },
    });

    const result = await featureQueueHandlers.list_wpf_feature_queue({
      site_id: 'production',
      status: 'in_progress',
      stale_before_minutes: 90,
    });

    expect(result.toolResult.isError).toBe(false);
    expect(mockedGetSite).toHaveBeenCalledWith('production');
    expect(mockedRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET',
      url: 'https://wpfusion.test/wp-json/wpf-agent/v1/queue',
      params: {
        status: 'in_progress',
        stale_before_minutes: 90,
      },
    }));
  });

  it('enqueues or explicitly requeues one request', async () => {
    await featureQueueHandlers.enqueue_wpf_feature({
      site_id: 'production',
      content_id: 42,
      rank: 3,
      requeue: true,
    });

    expect(mockedRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      url: 'https://wpfusion.test/wp-json/wpf-agent/v1/queue/items/42/enqueue',
      data: { rank: 3, requeue: true },
    }));
  });

  it('claims the next request with a named runner', async () => {
    await featureQueueHandlers.claim_next_wpf_feature({
      site_id: 'production',
      claimed_by: 'claude-wpf-feature-pipeline',
    });

    expect(mockedRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      url: 'https://wpfusion.test/wp-json/wpf-agent/v1/queue/claim',
      data: { claimed_by: 'claude-wpf-feature-pipeline' },
    }));
  });

  it('sends compare-and-set transition fields without unrelated metadata', async () => {
    await featureQueueHandlers.transition_wpf_feature({
      site_id: 'production',
      content_id: 42,
      run_id: 'run-123',
      expected_status: 'in_progress',
      next_status: 'pr_opened',
      pr_url: 'https://github.com/verygoodplugins/wp-fusion/pull/999',
    });

    expect(mockedRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST',
      url: 'https://wpfusion.test/wp-json/wpf-agent/v1/queue/items/42/transition',
      data: {
        run_id: 'run-123',
        expected_status: 'in_progress',
        next_status: 'pr_opened',
        pr_url: 'https://github.com/verygoodplugins/wp-fusion/pull/999',
      },
    }));
  });

  it('returns a useful conflict without leaking credentials', async () => {
    mockedRequest.mockRejectedValue({
      message: 'Request failed',
      response: {
        status: 409,
        data: { message: 'Run ID no longer owns this item.' },
      },
    });

    const result = await featureQueueHandlers.transition_wpf_feature({
      site_id: 'production',
      content_id: 42,
      run_id: 'stale-run',
      expected_status: 'in_progress',
      next_status: 'blocked',
      error: 'Verification failed.',
    });

    expect(result.toolResult.isError).toBe(true);
    expect(result.toolResult.content[0].text).toContain('Run ID no longer owns this item.');
    expect(result.toolResult.content[0].text).not.toContain('application-password');
  });

  it('rejects a queue response that omits stable item fields', async () => {
    mockedRequest.mockResolvedValue({
      data: { item: { id: 42, status: 'queued' } },
    });

    const result = await featureQueueHandlers.claim_next_wpf_feature({
      site_id: 'production',
      claimed_by: 'claude-wpf-feature-pipeline',
    });

    expect(result.toolResult.isError).toBe(true);
    expect(result.toolResult.content[0].text).toContain('invalid queue response');
  });
});
