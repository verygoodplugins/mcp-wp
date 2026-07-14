import axios from 'axios';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { siteManager } from '../config/site-manager.js';

const queueStatusSchema = z.enum([
  'queued',
  'in_progress',
  'blocked',
  'pr_opened',
  'done',
]);

const queueItemSchema = z.object({
  id: z.number().int().positive(),
  status: queueStatusSchema,
  rank: z.number().int().nullable(),
  run_id: z.string().nullable(),
  claimed_at: z.string().nullable(),
  pr_url: z.string().url().nullable(),
  last_error: z.string().nullable(),
}).passthrough();

const queueListResponseSchema = z.object({
  items: z.array(queueItemSchema),
  stale_claims: z.array(queueItemSchema).optional(),
}).passthrough();

const queueItemResponseSchema = z.object({
  item: queueItemSchema.nullable(),
}).passthrough();

const listQueueSchema = z.object({
  site_id: z.string().min(1).describe('Explicit configured WordPress site ID.'),
  status: queueStatusSchema.optional().describe('Optional queue status filter.'),
  stale_before_minutes: z.number().int().positive().optional()
    .describe('Include claims older than this many minutes as stale.'),
});

const enqueueFeatureSchema = z.object({
  site_id: z.string().min(1).describe('Explicit configured WordPress site ID.'),
  content_id: z.number().int().positive().describe('Feature-request post ID.'),
  rank: z.number().int().min(0).describe('Queue priority; lower values run first.'),
  requeue: z.boolean().optional()
    .describe('Explicitly allow a blocked item to return to queued.'),
});

const claimFeatureSchema = z.object({
  site_id: z.string().min(1).describe('Explicit configured WordPress site ID.'),
  claimed_by: z.string().min(1).max(191).describe('Stable runner identifier.'),
});

const transitionFeatureSchema = z.object({
  site_id: z.string().min(1).describe('Explicit configured WordPress site ID.'),
  content_id: z.number().int().positive().describe('Feature-request post ID.'),
  run_id: z.string().min(1).max(191).describe('Server-generated claim owner ID.'),
  expected_status: queueStatusSchema.describe('Current status required for compare-and-set.'),
  next_status: queueStatusSchema.describe('Requested next status.'),
  pr_url: z.string().url().optional().describe('Ready pull request URL.'),
  error: z.string().max(2000).optional().describe('Concise non-sensitive blocker summary.'),
});

type ListQueueParams = z.infer<typeof listQueueSchema>;
type EnqueueFeatureParams = z.infer<typeof enqueueFeatureSchema>;
type ClaimFeatureParams = z.infer<typeof claimFeatureSchema>;
type TransitionFeatureParams = z.infer<typeof transitionFeatureSchema>;

interface QueueRequest {
  siteId: string;
  method: 'GET' | 'POST';
  path: string;
  params?: Record<string, unknown>;
  data?: Record<string, unknown>;
  responseSchema: z.ZodType;
}

function queueTool(name: string, description: string, schema: z.ZodObject<any>): Tool {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties: schema.shape,
    } as unknown as Tool['inputSchema'],
  };
}

export const featureQueueTools: Tool[] = [
  queueTool(
    'list_wpf_feature_queue',
    'List WP Fusion feature queue items and optionally report stale in-progress claims.',
    listQueueSchema,
  ),
  queueTool(
    'enqueue_wpf_feature',
    'Human-controlled enqueue or explicit requeue of one WP Fusion feature request.',
    enqueueFeatureSchema,
  ),
  queueTool(
    'claim_next_wpf_feature',
    'Atomically claim the lowest-ranked queued WP Fusion feature request.',
    claimFeatureSchema,
  ),
  queueTool(
    'transition_wpf_feature',
    'Compare-and-set one claimed WP Fusion feature request to its next allowed state.',
    transitionFeatureSchema,
  ),
];

async function requestQueue({ siteId, method, path, params, data }: QueueRequest) {
  const site = siteManager.getSite(siteId);
  const siteBase = site.url.replace(/\/$/, '');
  const configuredBase = process.env.WORDPRESS_FEATURE_QUEUE_ENDPOINT || '/wpf-agent/v1';
  const endpointBase = `/${configuredBase.replace(/^\/+|\/+$/g, '')}`;
  const auth = Buffer.from(`${site.username}:${site.password}`).toString('base64');

  return axios.request({
    method,
    url: `${siteBase}/wp-json${endpointBase}${path}`,
    params,
    data,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${auth}`,
      'User-Agent': 'mcp-wp-feature-queue',
    },
    timeout: 30000,
  });
}

function queueSuccess(data: unknown) {
  return {
    toolResult: {
      content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
      isError: false,
    },
  };
}

function queueFailure(error: any) {
  const status = error.response?.status;
  const serverMessage = error.response?.data?.message;
  let message = typeof serverMessage === 'string' ? serverMessage : error.message;

  if (error instanceof z.ZodError) {
    message = `invalid queue response: ${error.issues[0]?.message || 'schema mismatch'}`;
  } else if (404 === status) {
    message = 'WP Fusion feature queue endpoint is not installed on the selected site.';
  } else if (401 === status || 403 === status) {
    message = 'The selected WordPress user cannot manage the WP Fusion feature queue.';
  } else if (409 === status && typeof serverMessage === 'string') {
    message = `Queue conflict: ${serverMessage}`;
  }

  return {
    toolResult: {
      content: [{ type: 'text' as const, text: `Error: ${message}` }],
      isError: true,
    },
  };
}

async function runQueueRequest(request: QueueRequest) {
  try {
    const response = await requestQueue(request);
    return queueSuccess(request.responseSchema.parse(response.data));
  } catch (error: any) {
    return queueFailure(error);
  }
}

export const featureQueueHandlers = {
  list_wpf_feature_queue: async (params: ListQueueParams) => runQueueRequest({
    siteId: params.site_id,
    method: 'GET',
    path: '/queue',
    params: {
      ...(params.status ? { status: params.status } : {}),
      ...(params.stale_before_minutes
        ? { stale_before_minutes: params.stale_before_minutes }
        : {}),
    },
    responseSchema: queueListResponseSchema,
  }),

  enqueue_wpf_feature: async (params: EnqueueFeatureParams) => runQueueRequest({
    siteId: params.site_id,
    method: 'POST',
    path: `/queue/items/${params.content_id}/enqueue`,
    data: {
      rank: params.rank,
      ...(params.requeue === undefined ? {} : { requeue: params.requeue }),
    },
    responseSchema: queueItemResponseSchema,
  }),

  claim_next_wpf_feature: async (params: ClaimFeatureParams) => runQueueRequest({
    siteId: params.site_id,
    method: 'POST',
    path: '/queue/claim',
    data: { claimed_by: params.claimed_by },
    responseSchema: queueItemResponseSchema,
  }),

  transition_wpf_feature: async (params: TransitionFeatureParams) => runQueueRequest({
    siteId: params.site_id,
    method: 'POST',
    path: `/queue/items/${params.content_id}/transition`,
    data: {
      run_id: params.run_id,
      expected_status: params.expected_status,
      next_status: params.next_status,
      ...(params.pr_url ? { pr_url: params.pr_url } : {}),
      ...(params.error ? { error: params.error } : {}),
    },
    responseSchema: queueItemResponseSchema,
  }),
};
