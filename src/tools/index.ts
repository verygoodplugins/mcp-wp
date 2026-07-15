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

/**
 * Select the tool registry exposed by one focused MCP process.
 *
 * An undefined allowlist preserves the default full registry. An explicit
 * allowlist fails closed if it is empty or contains an unknown name.
 */
export function selectTools(tools: Tool[], rawAllowlist?: string): Tool[] {
  if (rawAllowlist === undefined) {
    return tools;
  }

  const requested = new Set(
    rawAllowlist
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  );

  if (requested.size === 0) {
    throw new Error('MCP_WP_TOOL_ALLOWLIST must name at least one tool.');
  }

  const knownNames = new Set(tools.map((tool) => tool.name));
  const unknown = Array.from(requested).filter((name) => !knownNames.has(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown MCP_WP_TOOL_ALLOWLIST tools: ${unknown.join(', ')}`);
  }

  return tools.filter((tool) => requested.has(tool.name));
}

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
