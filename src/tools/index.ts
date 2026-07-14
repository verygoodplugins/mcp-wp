// src/tools/index.ts
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { unifiedContentTools, unifiedContentHandlers } from './unified-content.js';
import { unifiedTaxonomyTools, unifiedTaxonomyHandlers } from './unified-taxonomies.js';
import { pluginTools, pluginHandlers } from './plugins.js';
import { mediaTools, mediaHandlers } from './media.js';
import { userTools, userHandlers } from './users.js';
import { pluginRepositoryTools, pluginRepositoryHandlers } from './plugin-repository.js';
import { commentTools, commentHandlers } from './comments.js';
import { sqlQueryTools, sqlQueryHandlers } from './sql-query.js';
import { siteManagementTools, siteManagementHandlers } from './site-management.js';
import { contentSummaryTools, contentSummaryHandlers } from './content-summary.js';
import { featureQueueTools, featureQueueHandlers } from './feature-queue.js';

// Combine all tools
export const allTools: Tool[] = [
  ...unifiedContentTools,        // 8 tools (replaces posts, pages, custom-post-types)
  ...unifiedTaxonomyTools,       // 8 tools (replaces categories, custom-taxonomies)
  ...pluginTools,               // ~5 tools
  ...mediaTools,                // ~5 tools
  ...userTools,                 // ~5 tools
  ...pluginRepositoryTools,     // ~2 tools
  ...commentTools,              // ~5 tools
  ...sqlQueryTools,             // 1 tool (database queries)
  ...siteManagementTools,       // 3 tools (multi-site support)
  ...contentSummaryTools,       // 1 tool (audit/lookup summary)
  ...featureQueueTools          // 4 tools (WP Fusion feature queue)
];

// Combine all handlers
export const toolHandlers = {
  ...unifiedContentHandlers,
  ...unifiedTaxonomyHandlers,
  ...pluginHandlers,
  ...mediaHandlers,
  ...userHandlers,
  ...pluginRepositoryHandlers,
  ...commentHandlers,
  ...sqlQueryHandlers,
  ...siteManagementHandlers,
  ...contentSummaryHandlers,
  ...featureQueueHandlers
};
