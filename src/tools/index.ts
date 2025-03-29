// src/tools/index.ts
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { postTools, postHandlers } from './posts.js';
import { pageTools, pageHandlers } from './pages.js';
import { pluginTools, pluginHandlers } from './plugins.js';
import { mediaTools, mediaHandlers } from './media.js';
import { categoryTools, categoryHandlers } from './categories.js';
import { userTools, userHandlers } from './users.js';
import { pluginRepositoryTools, pluginRepositoryHandlers } from './plugin-repository.js';
import { commentTools, commentHandlers } from './comments.js';

// Combine all tools
export const allTools: Tool[] = [
  ...postTools,
  ...pageTools,
  ...pluginTools,
  ...mediaTools,
  ...categoryTools,
  ...userTools,
  ...pluginRepositoryTools,
  ...commentTools
];

// Combine all handlers
export const toolHandlers = {
  ...postHandlers,
  ...pageHandlers,
  ...pluginHandlers,
  ...mediaHandlers,
  ...categoryHandlers,
  ...userHandlers,
  ...pluginRepositoryHandlers,
  ...commentHandlers
};