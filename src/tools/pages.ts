// src/tools/pages.ts
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { makeWordPressRequest } from '../wordpress.js';
import { WPPage } from '../types/wordpress-types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const listPagesSchema = z.object({
  page: z.number().optional().describe("Page number (default 1)"),
  per_page: z.number().min(1).max(100).optional().describe("Items per page (default 10, max 100)"),
  search: z.string().optional().describe("Search term for page content or title"),
  after: z.string().optional().describe("ISO8601 date string to get pages published after this date"),
  author: z.union([z.number(), z.array(z.number())]).optional().describe("Author ID or array of IDs"),
  parent: z.number().optional().describe("Parent page ID"),
  status: z.enum(['publish', 'future', 'draft', 'pending', 'private']).optional().describe("Page status"),
  menu_order: z.number().optional().describe("Menu order value"),
  orderby: z.enum(['date', 'id', 'include', 'title', 'slug', 'menu_order']).optional().describe("Sort pages by parameter"),
  order: z.enum(['asc', 'desc']).optional().describe("Order sort attribute ascending or descending")
});

const getPageSchema = z.object({
  id: z.number().describe("Page ID")
}).strict();

const createPageSchema = z.object({
  title: z.string().describe("Page title"),
  content: z.string().describe("Page content"),
  status: z.enum(['publish', 'future', 'draft', 'pending', 'private']).optional().default('draft').describe("Page status"),
  excerpt: z.string().optional().describe("Page excerpt"),
  author: z.number().optional().describe("Author ID"),
  featured_media: z.number().optional().describe("Featured image ID"),
  parent: z.number().optional().describe("Parent page ID"),
  menu_order: z.number().optional().describe("Menu order value"),
  template: z.string().optional().describe("Page template"),
  slug: z.string().optional().describe("Page slug")
}).strict();

const updatePageSchema = z.object({
  id: z.number().describe("Page ID"),
  title: z.string().optional().describe("Page title"),
  content: z.string().optional().describe("Page content"),
  status: z.enum(['publish', 'future', 'draft', 'pending', 'private']).optional().describe("Page status"),
  excerpt: z.string().optional().describe("Page excerpt"),
  author: z.number().optional().describe("Author ID"),
  featured_media: z.number().optional().describe("Featured image ID"),
  parent: z.number().optional().describe("Parent page ID"),
  menu_order: z.number().optional().describe("Menu order value"),
  template: z.string().optional().describe("Page template"),
  slug: z.string().optional().describe("Page slug")
}).strict();

const deletePageSchema = z.object({
  id: z.number().describe("Page ID"),
  force: z.boolean().optional().describe("Whether to bypass trash and force deletion")
}).strict();

type ListPagesParams = z.infer<typeof listPagesSchema>;
type GetPageParams = z.infer<typeof getPageSchema>;
type CreatePageParams = z.infer<typeof createPageSchema>;
type UpdatePageParams = z.infer<typeof updatePageSchema>;
type DeletePageParams = z.infer<typeof deletePageSchema>;

export const pageTools: Tool[] = [
  {
    name: "list_pages",
    description: "Lists all pages with filtering, sorting, and pagination options",
    inputSchema: { type: "object", properties: listPagesSchema.shape }
  },
  {
    name: "get_page",
    description: "Gets a page by ID",
    inputSchema: { type: "object", properties: getPageSchema.shape }
  },
  {
    name: "create_page",
    description: "Creates a new page",
    inputSchema: { type: "object", properties: createPageSchema.shape }
  },
  {
    name: "update_page",
    description: "Updates an existing page",
    inputSchema: { type: "object", properties: updatePageSchema.shape }
  },
  {
    name: "delete_page",
    description: "Deletes a page",
    inputSchema: { type: "object", properties: deletePageSchema.shape }
  }
];

export const pageHandlers = {
  list_pages: async (params: ListPagesParams) => {
    try {
      const response = await makeWordPressRequest('GET', "pages", params);
      const pages: WPPage[] = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(pages, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error listing pages: ${errorMessage}` }],
        },
      };
    }
  },
  get_page: async (params: GetPageParams) => {
    try {
      const response = await makeWordPressRequest('GET', `pages/${params.id}`);
      const page: WPPage = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(page, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error getting page: ${errorMessage}` }],
        },
      };
    }
  },
  create_page: async (params: CreatePageParams) => {
    try {
      const response = await makeWordPressRequest('POST', "pages", params);
      const page: WPPage = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(page, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error creating page: ${errorMessage}` }],
        },
      };
    }
  },
  update_page: async (params: UpdatePageParams) => {
    try {
      const { id, ...updateData } = params;
      const response = await makeWordPressRequest('PUT', `pages/${id}`, updateData);
      const page: WPPage = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(page, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error updating page: ${errorMessage}` }],
        },
      };
    }
  },
  delete_page: async (params: DeletePageParams) => {
    try {
      const response = await makeWordPressRequest('DELETE', `pages/${params.id}`, { force: params.force });
      const page: WPPage = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(page, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error deleting page: ${errorMessage}` }],
        },
      };
    }
  }
};