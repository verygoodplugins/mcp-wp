// src/tools/posts.ts
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { makeWordPressRequest } from '../wordpress.js';
import { WPPost } from '../types/wordpress-types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const listPostsSchema = z.object({
  page: z.number().optional().describe("Page number (default 1)"),
  per_page: z.number().min(1).max(100).optional().describe("Items per page (default 10, max 100)"),
  search: z.string().optional().describe("Search term for post content or title"),
  after: z.string().optional().describe("ISO8601 date string to get posts published after this date"),
  author: z.union([z.number(), z.array(z.number())]).optional().describe("Author ID or array of IDs"),
  categories: z.union([z.number(), z.array(z.number())]).optional().describe("Category ID or array of IDs"),
  tags: z.union([z.number(), z.array(z.number())]).optional().describe("Tag ID or array of IDs"),
  status: z.enum(['publish', 'future', 'draft', 'pending', 'private']).optional().describe("Post status"),
  orderby: z.enum(['date', 'id', 'include', 'title', 'slug', 'modified']).optional().describe("Sort posts by parameter"),
  order: z.enum(['asc', 'desc']).optional().describe("Order sort attribute ascending or descending")
});

const getPostSchema = z.object({
  id: z.number().describe("Post ID")
}).strict();

const createPostSchema = z.object({
  title: z.string().describe("Post title"),
  content: z.string().describe("Post content"),
  status: z.enum(['publish', 'future', 'draft', 'pending', 'private']).optional().default('draft').describe("Post status"),
  excerpt: z.string().optional().describe("Post excerpt"),
  author: z.number().optional().describe("Author ID"),
  categories: z.array(z.number()).optional().describe("Array of category IDs"),
  tags: z.array(z.number()).optional().describe("Array of tag IDs"),
  featured_media: z.number().optional().describe("Featured image ID"),
  format: z.enum(['standard', 'aside', 'chat', 'gallery', 'link', 'image', 'quote', 'status', 'video', 'audio']).optional().describe("Post format"),
  slug: z.string().optional().describe("Post slug")
}).strict();

const updatePostSchema = z.object({
  id: z.number().describe("Post ID"),
  title: z.string().optional().describe("Post title"),
  content: z.string().optional().describe("Post content"),
  status: z.enum(['publish', 'future', 'draft', 'pending', 'private']).optional().describe("Post status"),
  excerpt: z.string().optional().describe("Post excerpt"),
  author: z.number().optional().describe("Author ID"),
  categories: z.array(z.number()).optional().describe("Array of category IDs"),
  tags: z.array(z.number()).optional().describe("Array of tag IDs"),
  featured_media: z.number().optional().describe("Featured image ID"),
  format: z.enum(['standard', 'aside', 'chat', 'gallery', 'link', 'image', 'quote', 'status', 'video', 'audio']).optional().describe("Post format"),
  slug: z.string().optional().describe("Post slug")
}).strict();

const deletePostSchema = z.object({
  id: z.number().describe("Post ID"),
  force: z.boolean().optional().describe("Whether to bypass trash and force deletion")
}).strict();

type ListPostsParams = z.infer<typeof listPostsSchema>;
type GetPostParams = z.infer<typeof getPostSchema>;
type CreatePostParams = z.infer<typeof createPostSchema>;
type UpdatePostParams = z.infer<typeof updatePostSchema>;
type DeletePostParams = z.infer<typeof deletePostSchema>;

export const postTools: Tool[] = [
  {
    name: "list_posts",
    description: "Lists all posts with filtering, sorting, and pagination options",
    inputSchema: { type: "object", properties: listPostsSchema.shape }
  },
  {
    name: "get_post",
    description: "Gets a post by ID",
    inputSchema: { type: "object", properties: getPostSchema.shape }
  },
  {
    name: "create_post",
    description: "Creates a new post",
    inputSchema: { type: "object", properties: createPostSchema.shape }
  },
  {
    name: "update_post",
    description: "Updates an existing post",
    inputSchema: { type: "object", properties: updatePostSchema.shape }
  },
  {
    name: "delete_post",
    description: "Deletes a post",
    inputSchema: { type: "object", properties: deletePostSchema.shape }
  }
];

export const postHandlers = {
  list_posts: async (params: ListPostsParams) => {
    try {
      const response = await makeWordPressRequest('GET', "posts", params);
      const posts: WPPost[] = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(posts, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error listing posts: ${errorMessage}` }],
        },
      };
    }
  },
  get_post: async (params: GetPostParams) => {
    try {
      const response = await makeWordPressRequest('GET', `posts/${params.id}`);
      const post: WPPost = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(post, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error getting post: ${errorMessage}` }],
        },
      };
    }
  },
  create_post: async (params: CreatePostParams) => {
    try {
      const response = await makeWordPressRequest('POST', "posts", params);
      const post: WPPost = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(post, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error creating post: ${errorMessage}` }],
        },
      };
    }
  },
  update_post: async (params: UpdatePostParams) => {
    try {
      const { id, ...updateData } = params;
      const response = await makeWordPressRequest('POST', `posts/${id}`, updateData);
      const post: WPPost = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(post, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error updating post: ${errorMessage}` }],
        },
      };
    }
  },
  delete_post: async (params: DeletePostParams) => {
    try {
      const response = await makeWordPressRequest('DELETE', `posts/${params.id}`, { force: params.force });
      const post: WPPost = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(post, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error deleting post: ${errorMessage}` }],
        },
      };
    }
  }
};