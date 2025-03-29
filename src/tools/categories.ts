// src/tools/categories.ts
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { makeWordPressRequest } from '../wordpress.js';
import { WPCategory } from '../types/wordpress-types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const listCategoriesSchema = z.object({
  page: z.number().optional().describe("Page number (default 1)"),
  per_page: z.number().min(1).max(100).optional().describe("Items per page (default 10, max 100)"),
  search: z.string().optional().describe("Search term for category name"),
  parent: z.number().optional().describe("Parent category ID"),
  orderby: z.enum(['id', 'include', 'name', 'slug', 'count']).optional().describe("Sort categories by parameter"),
  order: z.enum(['asc', 'desc']).optional().describe("Order sort attribute ascending or descending"),
  hide_empty: z.boolean().optional().describe("Whether to hide categories with no posts")
});

const getCategorySchema = z.object({
  id: z.number().describe("Category ID")
}).strict();

const createCategorySchema = z.object({
  name: z.string().describe("Category name"),
  slug: z.string().optional().describe("Category slug"),
  description: z.string().optional().describe("Category description"),
  parent: z.number().optional().describe("Parent category ID")
}).strict();

const updateCategorySchema = z.object({
  id: z.number().describe("Category ID"),
  name: z.string().optional().describe("Category name"),
  slug: z.string().optional().describe("Category slug"),
  description: z.string().optional().describe("Category description"),
  parent: z.number().optional().describe("Parent category ID")
}).strict();

const deleteCategorySchema = z.object({
  id: z.number().describe("Category ID"),
  force: z.boolean().optional().describe("Whether to bypass trash and force deletion")
}).strict();

type ListCategoriesParams = z.infer<typeof listCategoriesSchema>;
type GetCategoryParams = z.infer<typeof getCategorySchema>;
type CreateCategoryParams = z.infer<typeof createCategorySchema>;
type UpdateCategoryParams = z.infer<typeof updateCategorySchema>;
type DeleteCategoryParams = z.infer<typeof deleteCategorySchema>;

export const categoryTools: Tool[] = [
  {
    name: "list_categories",
    description: "Lists all categories with filtering, sorting, and pagination options",
    inputSchema: { type: "object", properties: listCategoriesSchema.shape }
  },
  {
    name: "get_category",
    description: "Gets a category by ID",
    inputSchema: { type: "object", properties: getCategorySchema.shape }
  },
  {
    name: "create_category",
    description: "Creates a new category",
    inputSchema: { type: "object", properties: createCategorySchema.shape }
  },
  {
    name: "update_category",
    description: "Updates an existing category",
    inputSchema: { type: "object", properties: updateCategorySchema.shape }
  },
  {
    name: "delete_category",
    description: "Deletes a category",
    inputSchema: { type: "object", properties: deleteCategorySchema.shape }
  }
];

export const categoryHandlers = {
  list_categories: async (params: ListCategoriesParams) => {
    try {
      const response = await makeWordPressRequest('GET', "categories", params);
      const categories: WPCategory[] = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(categories, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error listing categories: ${errorMessage}` }],
        },
      };
    }
  },
  get_category: async (params: GetCategoryParams) => {
    try {
      const response = await makeWordPressRequest('GET', `categories/${params.id}`);
      const category: WPCategory = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(category, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error getting category: ${errorMessage}` }],
        },
      };
    }
  },
  create_category: async (params: CreateCategoryParams) => {
    try {
      const response = await makeWordPressRequest('POST', "categories", params);
      const category: WPCategory = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(category, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error creating category: ${errorMessage}` }],
        },
      };
    }
  },
  update_category: async (params: UpdateCategoryParams) => {
    try {
      const { id, ...updateData } = params;
      const response = await makeWordPressRequest('POST', `categories/${id}`, updateData);
      const category: WPCategory = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(category, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error updating category: ${errorMessage}` }],
        },
      };
    }
  },
  delete_category: async (params: DeleteCategoryParams) => {
    try {
      const response = await makeWordPressRequest('DELETE', `categories/${params.id}`, { force: params.force });
      const category: WPCategory = response;
      return {
        toolResult: {
          content: [{ type: 'text', text: JSON.stringify(category, null, 2) }],
        },
      };
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      return {
        toolResult: {
          isError: true,
          content: [{ type: 'text', text: `Error deleting category: ${errorMessage}` }],
        },
      };
    }
  }
};
