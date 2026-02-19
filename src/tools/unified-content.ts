// src/tools/unified-content.ts
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { makeWordPressRequest, logToFile } from '../wordpress.js';
import { z } from 'zod';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { marked } from 'marked';

// Resolve cache directory: prefer env override, fall back to OS temp dir
const CACHE_DIR = process.env.UNIFIED_CONTENT_CACHE_DIR
  ? path.resolve(process.env.UNIFIED_CONTENT_CACHE_DIR)
  : path.join(os.tmpdir(), 'mcp-wp', '.cache');

// Ensure the cache directory exists at module load time (best-effort)
fs.ensureDir(CACHE_DIR).catch(() => {});

// Cache for post types to reduce API calls
let postTypesCache: any = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = parseInt(process.env.WORDPRESS_CACHE_DURATION || '3600000'); // Default 1 hour, configurable

// Helper function to load cache from disk
async function loadCacheFromDisk(): Promise<{ data: any; timestamp: number } | null> {
  try {
    await fs.ensureDir(CACHE_DIR);
    const cacheFilePath = path.join(CACHE_DIR, 'content-types-default.json');

    if (await fs.pathExists(cacheFilePath)) {
      const cache = await fs.readJson(cacheFilePath);
      return cache;
    }
  } catch (error) {
    logToFile(`Failed to load cache from disk: ${error}`);
  }
  return null;
}

// Helper function to save cache to disk
async function saveCacheToDisk(data: any): Promise<void> {
  try {
    await fs.ensureDir(CACHE_DIR);
    const cacheFilePath = path.join(CACHE_DIR, 'content-types-default.json');

    await fs.writeJson(cacheFilePath, {
      data,
      timestamp: Date.now()
    });
  } catch (error) {
    logToFile(`Failed to save cache to disk: ${error}`);
  }
}

// Helper function to get all post types with caching
async function getPostTypes(forceRefresh = false) {
  const now = Date.now();

  // Try memory cache first
  if (!forceRefresh && postTypesCache && (now - cacheTimestamp) < CACHE_DURATION) {
    logToFile('Using memory-cached post types');
    return postTypesCache;
  }

  // Try disk cache if memory cache is stale
  if (!forceRefresh) {
    const diskCache = await loadCacheFromDisk();
    if (diskCache && (now - diskCache.timestamp) < CACHE_DURATION) {
      logToFile('Using disk-cached post types');
      postTypesCache = diskCache.data;
      cacheTimestamp = diskCache.timestamp;
      return diskCache.data;
    }
  }

  // Fetch from API if cache is stale or refresh forced
  try {
    logToFile('Fetching post types from API');
    const response = await makeWordPressRequest('GET', 'types');
    postTypesCache = response;
    cacheTimestamp = now;

    // Save to disk for persistence
    await saveCacheToDisk(response);

    return response;
  } catch (error: any) {
    logToFile(`Error fetching post types: ${error.message}`);
    throw error;
  }
}

// Helper function to get the correct endpoint for a content type
async function getContentEndpoint(contentType: string): Promise<string> {
  // Quick return for standard types
  const standardMap: Record<string, string> = {
    'post': 'posts',
    'page': 'pages'
  };

  if (standardMap[contentType]) {
    return standardMap[contentType];
  }

  // For custom post types, we need to get the rest_base from discovered types
  try {
    const postTypes = await getPostTypes(false);
    if (postTypes[contentType] && postTypes[contentType].rest_base) {
      return postTypes[contentType].rest_base;
    }
  } catch (error) {
    logToFile(`Failed to get rest_base for content type ${contentType}: ${error}`);
  }

  // Fallback: try the content type as-is
  logToFile(`Warning: No rest_base found for content type '${contentType}', using as-is`);
  return contentType;
}

// Helper function to parse URL and extract slug and potential post type hints
function parseUrl(url: string): { slug: string; pathHints: string[] } {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    // Remove trailing slash and split path
    const pathParts = pathname.replace(/\/$/, '').split('/').filter(Boolean);

    // The slug is typically the last part of the URL
    const slug = pathParts[pathParts.length - 1] || '';

    // Path hints can help identify the post type
    const pathHints = pathParts.slice(0, -1);

    return { slug, pathHints };
  } catch (error) {
    logToFile(`Error parsing URL ${url}: ${error}`);
    return { slug: '', pathHints: [] };
  }
}

// Helper function to find content across multiple post types
async function findContentAcrossTypes(slug: string, contentTypes?: string[]) {
  const typesToSearch = contentTypes || [];

  // If no specific content types provided, get all available types
  if (typesToSearch.length === 0) {
    const allTypes = await getPostTypes(false);
    typesToSearch.push(...Object.keys(allTypes).filter(type =>
      type !== 'attachment' && type !== 'wp_block'
    ));
  }

  logToFile(`Searching for slug "${slug}" across content types: ${typesToSearch.join(', ')}`);

  // Check if parallel search is enabled (default: true)
  const enableParallel = process.env.WORDPRESS_PARALLEL_SEARCH !== 'false';

  if (enableParallel && typesToSearch.length > 1) {
    // Parallel search for better performance
    const searchPromises = typesToSearch.map(async (contentType) => {
      try {
        const endpoint = await getContentEndpoint(contentType);
        const response = await makeWordPressRequest('GET', endpoint, {
          slug: slug,
          per_page: 1
        });

        if (Array.isArray(response) && response.length > 0) {
          logToFile(`Found content with slug "${slug}" in content type "${contentType}"`);
          return { content: response[0], contentType };
        }
      } catch (error) {
        logToFile(`Error searching ${contentType}: ${error}`);
      }
      return null;
    });

    // Execute all searches in parallel
    const results = await Promise.all(searchPromises);

    // Return first non-null result
    const found = results.find(result => result !== null);
    if (found) return found;
  } else {
    // Sequential search (fallback or when only 1 type)
    for (const contentType of typesToSearch) {
      try {
        const endpoint = await getContentEndpoint(contentType);

        const response = await makeWordPressRequest('GET', endpoint, {
          slug: slug,
          per_page: 1
        });

        if (Array.isArray(response) && response.length > 0) {
          logToFile(`Found content with slug "${slug}" in content type "${contentType}"`);
          return { content: response[0], contentType };
        }
      } catch (error) {
        logToFile(`Error searching ${contentType}: ${error}`);
      }
    }
  }

  return null;
}

// Content format types
type ContentFormat = 'auto' | 'markdown' | 'html' | 'blocks';
type DetectedFormat = 'blocks' | 'html' | 'markdown' | 'text';

/**
 * Detects the format of content based on its structure
 */
function detectContentFormat(content: string): DetectedFormat {
  // Check for Gutenberg blocks first (most specific)
  if (/<!--\s*wp:/.test(content)) {
    return 'blocks';
  }

  // Check for HTML tags
  if (/<[a-z][\s\S]*>/i.test(content)) {
    return 'html';
  }

  // Check for common Markdown patterns
  const markdownPatterns = [
    /^#{1,6}\s+/m,           // Headers: # Header
    /\*\*[^*]+\*\*/,         // Bold: **text**
    /\*[^*]+\*/,             // Italic: *text*
    /\[[^\]]+\]\([^)]+\)/,   // Links: [text](url)
    /^[-*+]\s+/m,            // Unordered lists: - item
    /^\d+\.\s+/m,            // Ordered lists: 1. item
    /^>\s+/m,                // Blockquotes: > quote
    /`[^`]+`/,               // Inline code: `code`
    /^```/m,                 // Code blocks: ```
    /!\[[^\]]*\]\([^)]+\)/,  // Images: ![alt](url)
    /^---$/m,                // Horizontal rule
    /^\|.*\|$/m,             // Tables: | col1 | col2 |
  ];

  for (const pattern of markdownPatterns) {
    if (pattern.test(content)) {
      return 'markdown';
    }
  }

  return 'text';
}

/**
 * Converts Markdown to HTML using the marked library
 */
async function convertMarkdownToHtml(markdown: string): Promise<string> {
  try {
    // Configure marked for WordPress-friendly output
    const html = await marked(markdown, {
      gfm: true,       // GitHub Flavored Markdown
      breaks: false,   // Don't convert \n to <br>
    });

    return html;
  } catch (error) {
    logToFile(`Error converting markdown to HTML: ${error}`);
    throw error;
  }
}

/**
 * Converts HTML to Gutenberg block format
 * Wraps HTML elements in appropriate WordPress block comments
 */
function convertHtmlToBlocks(html: string): string {
  const blocks: string[] = [];

  // Split HTML into manageable chunks for block conversion
  // This regex matches common block-level elements
  const blockRegex = /<(p|h[1-6]|ul|ol|blockquote|pre|table|hr|div)[^>]*>[\s\S]*?<\/\1>|<(hr|br)\s*\/?>/gi;

  let match;
  let lastIndex = 0;

  while ((match = blockRegex.exec(html)) !== null) {
    // Handle any text before this match
    const textBefore = html.slice(lastIndex, match.index).trim();
    if (textBefore) {
      blocks.push(`<!-- wp:paragraph -->\n<p>${textBefore}</p>\n<!-- /wp:paragraph -->`);
    }

    const element = match[0];
    const tagName = (match[1] || match[2] || '').toLowerCase();

    switch (tagName) {
      case 'p':
        blocks.push(`<!-- wp:paragraph -->\n${element}\n<!-- /wp:paragraph -->`);
        break;
      case 'h1':
        blocks.push(`<!-- wp:heading {"level":1} -->\n${element}\n<!-- /wp:heading -->`);
        break;
      case 'h2':
        blocks.push(`<!-- wp:heading -->\n${element}\n<!-- /wp:heading -->`);
        break;
      case 'h3':
        blocks.push(`<!-- wp:heading {"level":3} -->\n${element}\n<!-- /wp:heading -->`);
        break;
      case 'h4':
        blocks.push(`<!-- wp:heading {"level":4} -->\n${element}\n<!-- /wp:heading -->`);
        break;
      case 'h5':
        blocks.push(`<!-- wp:heading {"level":5} -->\n${element}\n<!-- /wp:heading -->`);
        break;
      case 'h6':
        blocks.push(`<!-- wp:heading {"level":6} -->\n${element}\n<!-- /wp:heading -->`);
        break;
      case 'ul':
        blocks.push(`<!-- wp:list -->\n${element}\n<!-- /wp:list -->`);
        break;
      case 'ol':
        blocks.push(`<!-- wp:list {"ordered":true} -->\n${element}\n<!-- /wp:list -->`);
        break;
      case 'blockquote':
        blocks.push(`<!-- wp:quote -->\n${element}\n<!-- /wp:quote -->`);
        break;
      case 'pre':
        blocks.push(`<!-- wp:code -->\n${element}\n<!-- /wp:code -->`);
        break;
      case 'table':
        blocks.push(`<!-- wp:table -->\n<figure class="wp-block-table">${element}</figure>\n<!-- /wp:table -->`);
        break;
      case 'hr':
        blocks.push(`<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->`);
        break;
      default:
        // Wrap unknown elements in a paragraph block
        blocks.push(`<!-- wp:paragraph -->\n${element}\n<!-- /wp:paragraph -->`);
    }

    lastIndex = match.index + match[0].length;
  }

  // Handle any remaining content after the last match
  const remaining = html.slice(lastIndex).trim();
  if (remaining) {
    blocks.push(`<!-- wp:paragraph -->\n<p>${remaining}</p>\n<!-- /wp:paragraph -->`);
  }

  // If no blocks were created, wrap the entire content
  if (blocks.length === 0 && html.trim()) {
    return `<!-- wp:paragraph -->\n<p>${html}</p>\n<!-- /wp:paragraph -->`;
  }

  return blocks.join('\n\n');
}

/**
 * Main content processing function
 * Handles format detection, conversion, and optional block wrapping
 */
async function processContent(
  content: string,
  format: ContentFormat = 'auto',
  convertToBlocks: boolean = false
): Promise<string> {
  // Early return for empty content
  if (!content || !content.trim()) {
    return content;
  }

  // Detect format if auto
  let detectedFormat: DetectedFormat;
  if (format === 'auto') {
    detectedFormat = detectContentFormat(content);
    logToFile(`Auto-detected content format: ${detectedFormat}`);
  } else {
    detectedFormat = format === 'blocks' ? 'blocks' : format === 'html' ? 'html' : format === 'markdown' ? 'markdown' : 'text';
  }

  // If content is already blocks, pass through as-is
  if (detectedFormat === 'blocks') {
    logToFile('Content is already in Gutenberg block format, passing through');
    return content;
  }

  // Convert markdown to HTML if needed
  let htmlContent: string;
  if (detectedFormat === 'markdown') {
    logToFile('Converting markdown to HTML');
    htmlContent = await convertMarkdownToHtml(content);
  } else if (detectedFormat === 'html') {
    htmlContent = content;
  } else {
    // Plain text - wrap in paragraph tags
    htmlContent = `<p>${content.replace(/\n\n/g, '</p>\n<p>').replace(/\n/g, '<br>')}</p>`;
  }

  // Convert to blocks if requested
  if (convertToBlocks) {
    logToFile('Converting HTML to Gutenberg blocks');
    return convertHtmlToBlocks(htmlContent);
  }

  return htmlContent;
}

// Schema definitions
const listContentSchema = z.object({
  content_type: z.string().describe("The content type slug (e.g., 'post', 'page', 'product', 'documentation')"),
  page: z.number().optional().describe("Page number (default 1)"),
  per_page: z.number().min(1).max(100).optional().describe("Items per page (default 10, max 100)"),
  search: z.string().optional().describe("Search term for content title or body"),
  slug: z.string().optional().describe("Limit result to content with a specific slug"),
  status: z.string().optional().describe("Content status (publish, draft, etc.)"),
  author: z.union([z.number(), z.array(z.number())]).optional().describe("Author ID or array of IDs"),
  categories: z.union([z.number(), z.array(z.number())]).optional().describe("Category ID or array of IDs (for posts)"),
  tags: z.union([z.number(), z.array(z.number())]).optional().describe("Tag ID or array of IDs (for posts)"),
  parent: z.number().optional().describe("Parent ID (for hierarchical content like pages)"),
  orderby: z.string().optional().describe("Sort content by parameter"),
  order: z.enum(['asc', 'desc']).optional().describe("Order sort attribute"),
  after: z.string().optional().describe("ISO8601 date string to get content published after this date"),
  before: z.string().optional().describe("ISO8601 date string to get content published before this date")
});

const getContentSchema = z.object({
  content_type: z.string().describe("The content type slug"),
  id: z.coerce.number().describe("Content ID")
});

const createContentSchema = z.object({
  content_type: z.string().describe("The content type slug"),
  title: z.string().describe("Content title"),
  content: z.string().describe(
    "Content body. Accepts: Gutenberg blocks (<!-- wp:paragraph --><p>text</p><!-- /wp:paragraph -->), " +
    "HTML, or Markdown. Markdown is auto-converted to HTML when detected."
  ),
  content_format: z.enum(['auto', 'markdown', 'html', 'blocks']).optional().default('auto').describe(
    "Content format hint: 'auto' (detect and convert), 'markdown', 'html', or 'blocks' (Gutenberg)"
  ),
  convert_to_blocks: z.boolean().optional().default(false).describe(
    "Convert content to Gutenberg blocks. Recommended for sites using block editor."
  ),
  status: z.string().optional().default('draft').describe("Content status"),
  excerpt: z.string().optional().describe("Content excerpt"),
  slug: z.string().optional().describe("Content slug"),
  author: z.number().optional().describe("Author ID"),
  parent: z.number().optional().describe("Parent ID (for hierarchical content)"),
  categories: z.array(z.number()).optional().describe("Array of category IDs (for posts)"),
  tags: z.array(z.number()).optional().describe("Array of tag IDs (for posts)"),
  featured_media: z.number().optional().describe("Featured image ID"),
  format: z.string().optional().describe("Post format (standard, aside, gallery, etc.)"),
  menu_order: z.number().optional().describe("Menu order (for pages)"),
  meta: z.record(z.any()).optional().describe("Meta fields"),
  custom_fields: z.record(z.any()).optional().describe("Custom fields specific to this content type")
});

const updateContentSchema = z.object({
  content_type: z.string().describe("The content type slug"),
  id: z.coerce.number().describe("Content ID"),
  title: z.string().optional().describe("Content title"),
  content: z.string().optional().describe(
    "Content body. Accepts: Gutenberg blocks (<!-- wp:paragraph --><p>text</p><!-- /wp:paragraph -->), " +
    "HTML, or Markdown. Markdown is auto-converted to HTML when detected."
  ),
  content_format: z.enum(['auto', 'markdown', 'html', 'blocks']).optional().default('auto').describe(
    "Content format hint: 'auto' (detect and convert), 'markdown', 'html', or 'blocks' (Gutenberg)"
  ),
  convert_to_blocks: z.boolean().optional().default(false).describe(
    "Convert content to Gutenberg blocks. Recommended for sites using block editor."
  ),
  status: z.string().optional().describe("Content status"),
  excerpt: z.string().optional().describe("Content excerpt"),
  slug: z.string().optional().describe("Content slug"),
  author: z.number().optional().describe("Author ID"),
  parent: z.number().optional().describe("Parent ID"),
  categories: z.array(z.number()).optional().describe("Array of category IDs"),
  tags: z.array(z.number()).optional().describe("Array of tag IDs"),
  featured_media: z.number().optional().describe("Featured image ID"),
  format: z.string().optional().describe("Post format (standard, aside, gallery, etc.)"),
  menu_order: z.number().optional().describe("Menu order"),
  meta: z.record(z.any()).optional().describe("Meta fields"),
  custom_fields: z.record(z.any()).optional().describe("Custom fields")
});

const deleteContentSchema = z.object({
  content_type: z.string().describe("The content type slug"),
  id: z.coerce.number().describe("Content ID"),
  force: z.boolean().optional().describe("Whether to bypass trash and force deletion")
});

const discoverContentTypesSchema = z.object({
  refresh_cache: z.boolean().optional().describe("Force refresh the content types cache")
});

const findContentByUrlSchema = z.object({
  url: z.string().describe("The full URL of the content to find"),
  update_fields: z.object({
    title: z.string().optional(),
    content: z.string().optional().describe(
      "Content body. Accepts Gutenberg blocks, HTML, or Markdown (auto-converted to HTML)."
    ),
    content_format: z.enum(['auto', 'markdown', 'html', 'blocks']).optional().default('auto'),
    convert_to_blocks: z.boolean().optional().default(false),
    status: z.string().optional(),
    meta: z.record(z.any()).optional(),
    custom_fields: z.record(z.any()).optional()
  }).optional().describe("Optional fields to update after finding the content")
});

const getContentBySlugSchema = z.object({
  slug: z.string().describe("The slug to search for"),
  content_types: z.array(z.string()).optional().describe("Content types to search in (defaults to all)")
});

// Type definitions
type ListContentParams = z.infer<typeof listContentSchema>;
type GetContentParams = z.infer<typeof getContentSchema>;
type CreateContentParams = z.infer<typeof createContentSchema>;
type UpdateContentParams = z.infer<typeof updateContentSchema>;
type DeleteContentParams = z.infer<typeof deleteContentSchema>;
type DiscoverContentTypesParams = z.infer<typeof discoverContentTypesSchema>;
type FindContentByUrlParams = z.infer<typeof findContentByUrlSchema>;
type GetContentBySlugParams = z.infer<typeof getContentBySlugSchema>;

export const unifiedContentTools: Tool[] = [
  {
    name: "list_content",
    description: "Lists content of any type (posts, pages, or custom post types) with filtering and pagination",
    inputSchema: { type: "object", properties: listContentSchema.shape }
  },
  {
    name: "get_content",
    description: "Gets specific content by ID and content type",
    inputSchema: { type: "object", properties: getContentSchema.shape }
  },
  {
    name: "create_content",
    description: "Creates new content of any type. Accepts Markdown, HTML, or Gutenberg blocks — Markdown is auto-converted to HTML.",
    inputSchema: { type: "object", properties: createContentSchema.shape }
  },
  {
    name: "update_content",
    description: "Updates existing content of any type. Accepts Markdown, HTML, or Gutenberg blocks — Markdown is auto-converted to HTML.",
    inputSchema: { type: "object", properties: updateContentSchema.shape }
  },
  {
    name: "delete_content",
    description: "Deletes content of any type",
    inputSchema: { type: "object", properties: deleteContentSchema.shape }
  },
  {
    name: "discover_content_types",
    description: "Discovers all available content types (built-in and custom) in the WordPress site",
    inputSchema: { type: "object", properties: discoverContentTypesSchema.shape }
  },
  {
    name: "find_content_by_url",
    description: "Finds content by its URL, automatically detecting the content type, and optionally updates it. Accepts Markdown, HTML, or Gutenberg blocks for content updates.",
    inputSchema: { type: "object", properties: findContentByUrlSchema.shape }
  },
  {
    name: "get_content_by_slug",
    description: "Searches for content by slug across one or more content types",
    inputSchema: { type: "object", properties: getContentBySlugSchema.shape }
  }
];

export const unifiedContentHandlers = {
  list_content: async (params: ListContentParams) => {
    try {
      const endpoint = await getContentEndpoint(params.content_type);
      const { content_type, ...queryParams } = params;

      const response = await makeWordPressRequest('GET', endpoint, queryParams);

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: JSON.stringify(response, null, 2)
          }],
          isError: false
        }
      };
    } catch (error: any) {
      // Add helpful guidance for agents
      const guidance = error.message.includes('404') || error.message.includes('Not Found')
        ? '\nHint: Try running discover_content_types first to see available content types.'
        : '';
      return {
        toolResult: {
          content: [{
            type: 'text',
            text: `Error listing content: ${error.message}${guidance}`
          }],
          isError: true
        }
      };
    }
  },

  get_content: async (params: GetContentParams) => {
    try {
      const endpoint = await getContentEndpoint(params.content_type);
      const response = await makeWordPressRequest('GET', `${endpoint}/${params.id}`);

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: JSON.stringify(response, null, 2)
          }],
          isError: false
        }
      };
    } catch (error: any) {
      const guidance = error.message.includes('404') || error.message.includes('Not Found')
        ? '\nHint: Check if the content type exists with discover_content_types.'
        : '';
      return {
        toolResult: {
          content: [{
            type: 'text',
            text: `Error getting content: ${error.message}${guidance}`
          }],
          isError: true
        }
      };
    }
  },

  create_content: async (params: CreateContentParams) => {
    try {
      const endpoint = await getContentEndpoint(params.content_type);

      // Process content format (markdown -> HTML, optional block conversion)
      const processedContent = await processContent(
        params.content,
        params.content_format || 'auto',
        params.convert_to_blocks || false
      );

      const contentData: any = {
        title: params.title,
        content: processedContent,
        status: params.status,
        excerpt: params.excerpt,
        slug: params.slug,
        author: params.author,
        parent: params.parent,
        featured_media: params.featured_media,
        format: params.format,
        menu_order: params.menu_order
      };

      // Add post-specific fields
      if (params.categories) contentData.categories = params.categories;
      if (params.tags) contentData.tags = params.tags;

      // Add meta fields
      if (params.meta) contentData.meta = params.meta;

      // Add custom fields
      if (params.custom_fields) {
        Object.assign(contentData, params.custom_fields);
      }

      // Remove undefined values
      Object.keys(contentData).forEach(key => {
        if (contentData[key] === undefined) {
          delete contentData[key];
        }
      });

      const response = await makeWordPressRequest('POST', endpoint, contentData);

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: JSON.stringify(response, null, 2)
          }],
          isError: false
        }
      };
    } catch (error: any) {
      const guidance = error.message.includes('404') || error.message.includes('Not Found')
        ? '\nHint: The content type may not exist. Run discover_content_types to see available types.'
        : '';
      return {
        toolResult: {
          content: [{
            type: 'text',
            text: `Error creating content: ${error.message}${guidance}`
          }],
          isError: true
        }
      };
    }
  },

  update_content: async (params: UpdateContentParams) => {
    try {
      const endpoint = await getContentEndpoint(params.content_type);

      const updateData: any = {};

      // Only include defined fields
      if (params.title !== undefined) updateData.title = params.title;
      if (params.content !== undefined) {
        // Process content format (markdown -> HTML, optional block conversion)
        updateData.content = await processContent(
          params.content,
          params.content_format || 'auto',
          params.convert_to_blocks || false
        );
      }
      if (params.status !== undefined) updateData.status = params.status;
      if (params.excerpt !== undefined) updateData.excerpt = params.excerpt;
      if (params.slug !== undefined) updateData.slug = params.slug;
      if (params.author !== undefined) updateData.author = params.author;
      if (params.parent !== undefined) updateData.parent = params.parent;
      if (params.featured_media !== undefined) updateData.featured_media = params.featured_media;
      if (params.format !== undefined) updateData.format = params.format;
      if (params.menu_order !== undefined) updateData.menu_order = params.menu_order;
      if (params.categories !== undefined) updateData.categories = params.categories;
      if (params.tags !== undefined) updateData.tags = params.tags;
      if (params.meta !== undefined) updateData.meta = params.meta;

      // Add custom fields
      if (params.custom_fields) {
        Object.assign(updateData, params.custom_fields);
      }

      const response = await makeWordPressRequest('POST', `${endpoint}/${params.id}`, updateData);

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: JSON.stringify(response, null, 2)
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{
            type: 'text',
            text: `Error updating content: ${error.message}`
          }],
          isError: true
        }
      };
    }
  },

  delete_content: async (params: DeleteContentParams) => {
    try {
      const endpoint = await getContentEndpoint(params.content_type);

      const response = await makeWordPressRequest('DELETE', `${endpoint}/${params.id}`, {
        force: params.force || false
      });

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: JSON.stringify(response, null, 2)
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{
            type: 'text',
            text: `Error deleting content: ${error.message}`
          }],
          isError: true
        }
      };
    }
  },

  discover_content_types: async (params: DiscoverContentTypesParams) => {
    try {
      const contentTypes = await getPostTypes(params.refresh_cache || false);

      // Format the response to be more readable
      const formattedTypes = Object.entries(contentTypes).map(([slug, type]: [string, any]) => ({
        slug,
        name: type.name,
        description: type.description,
        rest_base: type.rest_base,
        hierarchical: type.hierarchical,
        supports: type.supports,
        taxonomies: type.taxonomies
      }));

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: JSON.stringify(formattedTypes, null, 2)
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{
            type: 'text',
            text: `Error discovering content types: ${error.message}`
          }],
          isError: true
        }
      };
    }
  },

  find_content_by_url: async (params: FindContentByUrlParams) => {
    try {
      const { slug, pathHints } = parseUrl(params.url);

      if (!slug) {
        throw new Error('Could not extract slug from URL');
      }

      logToFile(`Searching for content with slug: ${slug}, path hints: ${pathHints.join('/')}`);

      // Try to guess content types based on URL structure
      const priorityTypes: string[] = [];

      // Common URL patterns to content type mappings
      const pathMappings: Record<string, string[]> = {
        'documentation': ['documentation', 'docs', 'doc'],
        'docs': ['documentation', 'docs', 'doc'],
        'products': ['product'],
        'portfolio': ['portfolio', 'project'],
        'services': ['service'],
        'testimonials': ['testimonial'],
        'team': ['team_member', 'staff'],
        'events': ['event'],
        'courses': ['course', 'lesson']
      };

      // Check path hints for potential content types
      for (const hint of pathHints) {
        const mappedTypes = pathMappings[hint.toLowerCase()];
        if (mappedTypes) {
          priorityTypes.push(...mappedTypes);
        }
      }

      // Always check standard content types as fallback
      priorityTypes.push('post', 'page');

      // Remove duplicates
      const typesToSearch = [...new Set(priorityTypes)];

      // Find the content
      const result = await findContentAcrossTypes(slug, typesToSearch);

      if (!result) {
        // If not found in priority types, search all types
        const allResult = await findContentAcrossTypes(slug);
        if (!allResult) {
          throw new Error(`No content found with URL: ${params.url}`);
        }

        const { content, contentType } = allResult;

        // Update if requested
        if (params.update_fields) {
          const endpoint = await getContentEndpoint(contentType);

          const updateData: any = {};
          if (params.update_fields.title !== undefined) updateData.title = params.update_fields.title;
          if (params.update_fields.content !== undefined) {
            // Process content format (markdown -> HTML, optional block conversion)
            updateData.content = await processContent(
              params.update_fields.content,
              params.update_fields.content_format || 'auto',
              params.update_fields.convert_to_blocks || false
            );
          }
          if (params.update_fields.status !== undefined) updateData.status = params.update_fields.status;
          if (params.update_fields.meta !== undefined) updateData.meta = params.update_fields.meta;
          if (params.update_fields.custom_fields !== undefined) {
            Object.assign(updateData, params.update_fields.custom_fields);
          }

          const updatedContent = await makeWordPressRequest('POST', `${endpoint}/${content.id}`, updateData);

          return {
            toolResult: {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  found: true,
                  content_type: contentType,
                  content_id: content.id,
                  original_url: params.url,
                  updated: true,
                  content: updatedContent
                }, null, 2)
              }],
              isError: false
            }
          };
        }

        return {
          toolResult: {
            content: [{
              type: 'text',
              text: JSON.stringify({
                found: true,
                content_type: contentType,
                content_id: content.id,
                original_url: params.url,
                content: content
              }, null, 2)
            }],
            isError: false
          }
        };
      }

      const { content, contentType } = result;

      // Update if requested
      if (params.update_fields) {
        const endpoint = await getContentEndpoint(contentType);

        const updateData: any = {};
        if (params.update_fields.title !== undefined) updateData.title = params.update_fields.title;
        if (params.update_fields.content !== undefined) {
          // Process content format (markdown -> HTML, optional block conversion)
          updateData.content = await processContent(
            params.update_fields.content,
            params.update_fields.content_format || 'auto',
            params.update_fields.convert_to_blocks || false
          );
        }
        if (params.update_fields.status !== undefined) updateData.status = params.update_fields.status;
        if (params.update_fields.meta !== undefined) updateData.meta = params.update_fields.meta;
        if (params.update_fields.custom_fields !== undefined) {
          Object.assign(updateData, params.update_fields.custom_fields);
        }

        const updatedContent = await makeWordPressRequest('POST', `${endpoint}/${content.id}`, updateData);

        return {
          toolResult: {
            content: [{
              type: 'text',
              text: JSON.stringify({
                found: true,
                content_type: contentType,
                content_id: content.id,
                original_url: params.url,
                updated: true,
                content: updatedContent
              }, null, 2)
            }],
            isError: false
          }
        };
      }

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              found: true,
              content_type: contentType,
              content_id: content.id,
              original_url: params.url,
              content: content
            }, null, 2)
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{
            type: 'text',
            text: `Error finding content by URL: ${error.message}`
          }],
          isError: true
        }
      };
    }
  },

  get_content_by_slug: async (params: GetContentBySlugParams) => {
    try {
      const result = await findContentAcrossTypes(params.slug, params.content_types);

      if (!result) {
        throw new Error(`No content found with slug: ${params.slug}`);
      }

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              found: true,
              content_type: result.contentType,
              content: result.content
            }, null, 2)
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{
            type: 'text',
            text: `Error getting content by slug: ${error.message}`
          }],
          isError: true
        }
      };
    }
  }
};
