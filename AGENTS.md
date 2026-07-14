# AGENTS.md

This file provides guidance to coding agents (Claude Code, Cursor, Codex, and others) when working with code in this repository. `CLAUDE.md` is a one-line `@AGENTS.md` import so Claude Code picks up this same content.

## Project Overview

This is a WordPress MCP (Model Context Protocol) server that allows interaction with WordPress sites through natural language via MCP-compatible clients like Claude Desktop. The server exposes WordPress REST API functionality as MCP tools.

## Development Commands

### Build and Run
```bash
# Install dependencies
npm install

# Build TypeScript to JavaScript (tsc, outputs to build/)
npm run build

# Run in development mode with hot reload (tsx watch)
npm run dev

# Run the built server
npm start

# Clean build artifacts
npm run clean
```

Run `npm test` for the Vitest suite and `npm run build` for TypeScript. The
committed lockfile supports reproducible installs with `npm ci`; `npm run
prepare` also builds automatically during install and publish.

### Environment Setup

#### Single Site Configuration
Create a `.env` file in the project root with:
```env
WORDPRESS_API_URL=https://your-wordpress-site.com
WORDPRESS_USERNAME=wp_username
WORDPRESS_PASSWORD=wp_app_password
```

#### Multi-Site Configuration
For managing multiple WordPress sites (numbered config, read in `src/config/site-manager.ts:48`):
```env
# Site 1 (Production)
WORDPRESS_1_URL=https://production-site.com
WORDPRESS_1_USERNAME=admin
WORDPRESS_1_PASSWORD=app_password_1
WORDPRESS_1_ID=production
WORDPRESS_1_DEFAULT=true
WORDPRESS_1_ALIASES=prod,main

# Site 2 (Staging)
WORDPRESS_2_URL=https://staging-site.com
WORDPRESS_2_USERNAME=admin
WORDPRESS_2_PASSWORD=app_password_2
WORDPRESS_2_ID=staging
WORDPRESS_2_ALIASES=stage,dev
```

If no numbered sites are found, the server falls back to the legacy single-site `WORDPRESS_API_URL`/`WORDPRESS_USERNAME`/`WORDPRESS_PASSWORD` variables. The first configured site is the default unless a `WORDPRESS_N_DEFAULT=true` is set.

The app password can be generated from WordPress admin panel following the [Application Passwords guide](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide#Getting-Credentials).

#### Optional Environment Variables
- `WORDPRESS_LOG_LEVEL` — `debug` | `info` | `error` (default `error`). Controls log verbosity (logs go to **stderr**, not a file).
- `DISABLE_LOGGING=true` — silences all logging.
- `WORDPRESS_SQL_ENDPOINT` — override the SQL-query endpoint (default `/mcp/v1/query`); see `src/tools/sql-query.ts:95`.
- `WORDPRESS_FEATURE_QUEUE_ENDPOINT` — override the WP Fusion feature-queue
  endpoint root (default `/wpf-agent/v1`).
- `WORDPRESS_CACHE_DURATION` — cache TTL for WordPress lookups.
- `WORDPRESS_PARALLEL_SEARCH` — toggle parallel content-type search.
- `UNIFIED_CONTENT_CACHE_DIR` — directory for the unified-content cache.

## Architecture

### Core Components

1. **MCP Server (`src/server.ts`)**:
   - Entry point that initializes the server using the `McpServer` class from the ModelContextProtocol SDK
   - Registers every tool from `allTools` with its handler in a loop (`src/server.ts:27`) and logs the registered count
   - Uses `StdioServerTransport` for communication with Claude Desktop
   - Validates environment variables and establishes WordPress connection on startup

2. **Site Manager (`src/config/site-manager.ts`)**:
   - Manages multiple WordPress site configurations
   - Lazy loads site configurations from environment variables
   - Maintains separate authenticated Axios clients for each site
   - Provides site detection from context (domain mentions, aliases, site IDs)
   - Supports both numbered multi-site config and legacy single-site config

3. **WordPress Client (`src/wordpress.ts`)**:
   - Manages authenticated Axios instance for WordPress REST API calls
   - Integrates with SiteManager for multi-site support
   - Handles authentication using Basic Auth with application passwords
   - Provides `makeWordPressRequest()` wrapper for all API calls with optional `siteId` parameter
   - Logs to **stderr** via `logToFile()` (`src/wordpress.ts:20`), gated by `WORDPRESS_LOG_LEVEL` / `DISABLE_LOGGING` — stdout is reserved for the MCP protocol
   - Special handler `searchWordPressPluginRepository()` (`src/wordpress.ts:130`) for WordPress.org plugin search

4. **Tool System (`src/tools/`)**:
   - Each WordPress entity (posts, pages, media, etc.) has its own module
   - Each module exports a tools array and a handlers object
   - Tools use Zod schemas for input validation and type safety
   - Unified content and site-management tools accept an optional `site_id`;
     WP Fusion feature-queue tools require an explicit `site_id` to prevent
     writes to the wrong site; other modules use the default site
   - All tools are aggregated in `src/tools/index.ts` (`allTools` / `toolHandlers`)

5. **CLI Launcher (`src/cli.ts`)**:
   - A thin alternate launcher that checks env vars and spawns `server.js`. Note: the package `bin` entry points at `build/server.js` directly, not at this file.

### Tool Pattern

Each tool module follows this pattern:
```typescript
// Define Zod schemas for input validation
const listSchema = z.object({...});
const getSchema = z.object({...});
const createSchema = z.object({...});
const updateSchema = z.object({...});
const deleteSchema = z.object({...});

// Export tools array with MCP tool definitions
export const entityTools: Tool[] = [
  { name: "list_entity", description: "...", inputSchema: {...} },
  { name: "get_entity", description: "...", inputSchema: {...} },
  { name: "create_entity", description: "...", inputSchema: {...} },
  { name: "update_entity", description: "...", inputSchema: {...} },
  { name: "delete_entity", description: "...", inputSchema: {...} }
];

// Export handlers object with async functions
export const entityHandlers = {
  list_entity: async (params) => {...},
  get_entity: async (params) => {...},
  create_entity: async (params) => {...},
  update_entity: async (params) => {...},
  delete_entity: async (params) => {...}
};
```

### Unified Tool Architecture

The MCP server uses a **unified tool approach** to reduce complexity and tool
count. Instead of separate tools for posts, pages, and custom post types, there
are unified tools that handle all content types. The server currently registers
**48 tools**, aggregated in `src/tools/index.ts`.

#### Unified Content Tools (`unified-content.ts`) — 8 tools
Handles ALL content types (posts, pages, custom post types) with a single set of tools:
- `list_content` — List any content type with filtering and pagination
- `get_content` — Get specific content by ID and type
- `create_content` — Create new content of any type
- `update_content` — Update existing content of any type
- `delete_content` — Delete content of any type
- `discover_content_types` — Find all available content types
- `find_content_by_url` — Smart URL resolver with optional update
- `get_content_by_slug` — Search by slug across content types

#### Unified Taxonomy Tools (`unified-taxonomies.ts`) — 8 tools
Handles ALL taxonomies (categories, tags, custom taxonomies) with a single set of tools:
- `discover_taxonomies` — Find all available taxonomies
- `list_terms` — List terms in any taxonomy
- `get_term` — Get specific term by ID
- `create_term` — Create new term in any taxonomy
- `update_term` — Update existing term
- `delete_term` — Delete term from any taxonomy
- `assign_terms_to_content` — Assign terms to any content type
- `get_content_terms` — Get all terms for any content

#### Plugin Tools (`plugins.ts`) — 5 tools
- `list_plugins`, `get_plugin`, `activate_plugin`, `deactivate_plugin`, `create_plugin`

#### Media Tools (`media.ts`) — 4 tools
- `list_media`, `create_media`, `edit_media`, `delete_media`

#### User Tools (`users.ts`) — 5 tools
- `list_users`, `get_user`, `create_user`, `update_user`, `delete_user`

#### Comment Tools (`comments.ts`) — 5 tools
- `list_comments`, `get_comment`, `create_comment`, `update_comment`, `delete_comment`

#### Plugin Repository Tools (`plugin-repository.ts`) — 2 tools
- `search_plugin_repository` — Search WordPress.org for plugins
- `get_plugin_details` — Get details for a WordPress.org plugin

#### SQL Query Tool (`sql-query.ts`) — 1 tool
- `execute_sql_query` — Execute read-only database queries. Requires a custom endpoint on the WordPress side; uses `/mcp/v1/query` by default, overridable via `WORDPRESS_SQL_ENDPOINT`.

#### WP Fusion Feature Queue (`feature-queue.ts`) — 4 tools
- `list_wpf_feature_queue` — List queue items and stale claims.
- `enqueue_wpf_feature` — Enqueue or explicitly requeue an approved request.
- `claim_next_wpf_feature` — Atomically claim the next request.
- `transition_wpf_feature` — Compare-and-set a claimed request's status.

#### Site Management Tools (`site-management.ts`) — 3 tools
- `list_sites` — List all configured WordPress sites
- `get_site` — Get details about a specific site
- `test_site` — Test connection to a WordPress site

### Key Features

#### Smart URL Resolution
The `find_content_by_url` tool can:
- Take any WordPress URL and automatically find the corresponding content
- Detect the content type from URL patterns (e.g., `/documentation/` → documentation CPT)
- Optionally update the content in a single operation
- Cache content type information to minimize API calls

Example: Given `https://site.com/documentation/api-guide/`, it will:
1. Extract the slug `api-guide`
2. Detect hints suggesting a documentation content type
3. Search efficiently across relevant content types
4. Return or update the found content

#### Unified Content Management
All content operations use a single `content_type` parameter:
```json
{
  "content_type": "post",        // for blog posts
  "content_type": "page",        // for static pages
  "content_type": "product",     // for custom post types
  "content_type": "documentation" // for custom post types
}
```

#### Unified Taxonomy Management
All taxonomy operations use a single `taxonomy` parameter:
```json
{
  "taxonomy": "category",        // for categories
  "taxonomy": "post_tag",        // for tags
  "taxonomy": "product_category", // for custom taxonomies
  "taxonomy": "skill"            // for custom taxonomies
}
```

#### Multi-Site Support
The unified content tools (and the `get_site`/`test_site` site-management tools) accept an optional `site_id` parameter to target a specific site:
```json
{
  "content_type": "post",
  "site_id": "production"  // Optional - targets specific site
}
```

If `site_id` is not provided, the default site is used. Sites can be managed via:
- `list_sites` - See all configured sites
- `get_site` - Get details about a site
- `test_site` - Test connection to a site

## TypeScript Configuration

- Target: ES2022 with ESNext modules (`moduleResolution: node`)
- Strict mode enabled
- Source in `src/`, builds to `build/` (`outDir`)
- Declaration files generated

## Claude Desktop Integration

The server integrates with Claude Desktop via the configuration in `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "wordpress": {
      "command": "npx",
      "args": ["-y", "@instawp/mcp-wp"],
      "env": {
        "WORDPRESS_API_URL": "https://your-site.com",
        "WORDPRESS_USERNAME": "username",
        "WORDPRESS_PASSWORD": "app_password"
      }
    }
  }
}
```

## Error Handling

- All API requests are wrapped in try-catch blocks
- Errors are logged to **stderr** via `logToFile()` (level `error`) with request/response details
- Process signals (SIGTERM, SIGINT) are handled gracefully
- Uncaught exceptions and rejections trigger proper shutdown

## Key Dependencies

- `@modelcontextprotocol/sdk`: MCP protocol implementation
- `axios`: HTTP client for WordPress REST API
- `zod` + `zod-to-json-schema`: Runtime type validation and JSON-schema generation for tool inputs
- `dotenv`: Environment variable management
- `fs-extra`: Filesystem helpers (e.g. content cache)
- `marked`: Markdown parsing for content handling
- `tsx`: TypeScript execution for development
