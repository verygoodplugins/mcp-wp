// src/tools/content-summary.ts
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { makeWordPressRequest } from '../wordpress.js';
import { findContentByUrl, getContentEndpoint } from './unified-content.js';

const getContentSummarySchema = z.object({
  id: z.coerce.number().optional().describe(
    "Content ID. Mutually exclusive with `url` — provide exactly one."
  ),
  url: z.string().optional().describe(
    "Public URL of the content (e.g. https://site.com/blog/my-post/). Mutually exclusive with `id`."
  ),
  content_type: z.string().optional().default('post').describe(
    "Content type slug. Used only when looking up by `id`; when looking up by `url` the type is detected from the URL. Defaults to 'post'."
  ),
  site_id: z.string().optional().describe("Site ID (for multi-site setups)")
});

type GetContentSummaryParams = z.infer<typeof getContentSummarySchema>;

const HTML_TAG_REGEX = /<[^>]*>/g;
const WHITESPACE_RUN_REGEX = /\s+/g;
const HTML_ENTITY_REGEX = /&(amp|lt|gt|quot|#39|nbsp);/g;

function decodeBasicEntities(s: string): string {
  return s.replace(HTML_ENTITY_REGEX, (match, entity) => {
    switch (entity) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case '#39': return "'";
      case 'nbsp': return ' ';
      default: return match;
    }
  });
}

export function htmlToPlainText(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  const noTags = input.replace(HTML_TAG_REGEX, ' ');
  const decoded = decodeBasicEntities(noTags);
  return decoded.replace(WHITESPACE_RUN_REGEX, ' ').trim();
}

export function countWords(plainText: string): number {
  if (plainText.length === 0) return 0;
  return plainText.split(/\s+/).filter(Boolean).length;
}

// Yoast embeds wordCount on whichever schema.org node represents the article.
// We scan the @graph rather than guessing the node type so this works on
// posts, pages, products, recipes, etc.
export function extractYoastWordCount(yoastJson: any): number | null {
  const graph = yoastJson?.schema?.['@graph'];
  if (!Array.isArray(graph)) return null;
  for (const node of graph) {
    if (node && typeof node.wordCount === 'number') return node.wordCount;
  }
  return null;
}

export interface ContentSummary {
  id: number;
  title: string;
  slug: string;
  status: string;
  link: string;
  excerpt: string;
  date_modified: string;
  categories: number[];
  tags: number[];
  featured_media: number;
  word_count: number;
  yoast_focus_keyword: string | null;
  yoast_meta_title: string | null;
  yoast_meta_description: string | null;
}

export function buildContentSummary(post: any): ContentSummary {
  const yoast = post?.yoast_head_json;
  const yoastWordCount = extractYoastWordCount(yoast);
  const contentText = htmlToPlainText(post?.content?.rendered);
  const focusKw = post?.meta?._yoast_wpseo_focuskw;

  return {
    id: typeof post?.id === 'number' ? post.id : 0,
    title: htmlToPlainText(post?.title?.rendered),
    slug: typeof post?.slug === 'string' ? post.slug : '',
    status: typeof post?.status === 'string' ? post.status : '',
    link: typeof post?.link === 'string' ? post.link : '',
    excerpt: htmlToPlainText(post?.excerpt?.rendered),
    date_modified: typeof post?.modified === 'string' ? post.modified : '',
    categories: Array.isArray(post?.categories) ? post.categories : [],
    tags: Array.isArray(post?.tags) ? post.tags : [],
    featured_media: typeof post?.featured_media === 'number' ? post.featured_media : 0,
    word_count: yoastWordCount ?? countWords(contentText),
    yoast_focus_keyword: typeof focusKw === 'string' && focusKw.length > 0 ? focusKw : null,
    yoast_meta_title: typeof yoast?.title === 'string' ? yoast.title : null,
    yoast_meta_description: typeof yoast?.description === 'string' ? yoast.description : null,
  };
}

export const contentSummaryTools: Tool[] = [
  {
    name: "get_content_summary",
    description:
      "Returns a minimal summary of a single piece of content — id, title, slug, status, link, excerpt, modified date, taxonomy IDs, featured media, word count, and Yoast SEO fields. Designed for audit and lookup workflows where the full WP REST response (which can exceed 50KB on recipe posts) is overkill. Look up by `id` (with optional `content_type`, defaulting to 'post') or by `url`.",
    inputSchema: { type: "object", properties: getContentSummarySchema.shape }
  }
];

export const contentSummaryHandlers = {
  get_content_summary: async (params: GetContentSummaryParams) => {
    try {
      const hasId = params.id !== undefined && params.id !== null;
      const hasUrl = typeof params.url === 'string' && params.url.length > 0;

      if (hasId && hasUrl) {
        throw new Error("Provide exactly one of `id` or `url`, not both.");
      }
      if (!hasId && !hasUrl) {
        throw new Error("Provide one of `id` or `url`.");
      }

      let contentType = params.content_type ?? 'post';
      let id: number;

      if (hasUrl) {
        const ref = await findContentByUrl(params.url!, params.site_id);
        if (!ref) {
          throw new Error(`No content found with URL: ${params.url}`);
        }
        contentType = ref.contentType;
        id = ref.content.id;
      } else {
        id = params.id!;
      }

      const endpoint = await getContentEndpoint(contentType, params.site_id);
      // Bypass response trimming so yoast_head_json reaches us — the trim
      // documented in PR #16 strips it from every response by default, with
      // `rawResponse: true` as the documented escape hatch for callers that
      // need it.
      const raw = await makeWordPressRequest('GET', `${endpoint}/${id}`, undefined, {
        siteId: params.site_id,
        rawResponse: true
      });

      const summary = buildContentSummary(raw.data);

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: JSON.stringify(summary, null, 2)
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{
            type: 'text',
            text: `Error getting content summary: ${error.message}`
          }],
          isError: true
        }
      };
    }
  }
};
