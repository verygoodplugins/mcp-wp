// Integration test: round-trip a WP Recipe Maker recipe through the unified
// content handlers. Hits a real WordPress install. Skipped automatically when
// credentials are not configured or the target site does not have WPRM.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as dotenv from 'dotenv';
import { initWordPress, makeWordPressRequest } from '../../src/wordpress.js';
import { unifiedContentHandlers } from '../../src/tools/unified-content.js';

dotenv.config();

const hasCreds =
  !!process.env.WORDPRESS_API_URL &&
  !!process.env.WORDPRESS_USERNAME &&
  !!process.env.WORDPRESS_PASSWORD;

function parseHandlerJson(result: any) {
  if (result.toolResult.isError) {
    throw new Error(`Handler returned error: ${result.toolResult.content[0]?.text}`);
  }
  return JSON.parse(result.toolResult.content[0].text);
}

describe.skipIf(!hasCreds)('wprm_recipe round-trip (integration)', () => {
  let recipeId: number | null = null;
  let wprmAvailable = false;

  beforeAll(async () => {
    await initWordPress();
    try {
      const types: any = await makeWordPressRequest('GET', 'types');
      wprmAvailable = !!(types && types.wprm_recipe);
    } catch {
      wprmAvailable = false;
    }
  });

  afterAll(async () => {
    if (recipeId !== null) {
      try {
        await unifiedContentHandlers.delete_content({
          content_type: 'wprm_recipe',
          id: recipeId,
          force: true,
        } as any);
      } catch {
        // Best-effort cleanup; surface the test failure instead of this one.
      }
    }
  });

  it('creates a recipe with grouped ingredients via custom_fields.recipe', async (ctx) => {
    if (!wprmAvailable) {
      ctx.skip();
      return;
    }
    const title = `mcp-wp integration test ${Date.now()}`;
    const result = await unifiedContentHandlers.create_content({
      content_type: 'wprm_recipe',
      title,
      content: 'Integration test recipe; safe to delete.',
      status: 'draft',
      custom_fields: {
        recipe: {
          name: title,
          summary: 'Round-trip summary',
          servings: '4',
          servings_unit: 'people',
          prep_time: '5',
          cook_time: '20',
          total_time: '25',
          ingredients: [
            {
              name: 'For the sauce',
              ingredients: [
                { uid: 0, amount: '2', unit: 'tbsp', name: 'Soy sauce', notes: '' },
                { uid: 1, amount: '1', unit: 'tsp', name: 'Sesame oil', notes: '' },
              ],
            },
            {
              name: 'For the chicken',
              ingredients: [
                { uid: 2, amount: '1', unit: 'lb', name: 'Chicken thigh', notes: 'boneless skinless' },
              ],
            },
          ],
          instructions: [
            {
              name: '',
              instructions: [
                { uid: 0, name: '', text: 'Whisk the sauce.', ingredients: [] },
                { uid: 1, name: '', text: 'Marinate the chicken.', ingredients: [] },
              ],
            },
          ],
          notes: 'Round-trip test notes',
        },
      },
    } as any);

    const created = parseHandlerJson(result);
    expect(typeof created.id).toBe('number');
    expect(created.type).toBe('wprm_recipe');
    expect(created.recipe?.servings).toBe('4');
    expect(created.recipe?.prep_time).toBe('5');
    expect(created.recipe?.cook_time).toBe('20');
    expect(created.recipe?.total_time).toBe('25');
    expect(created.recipe?.ingredients).toHaveLength(2);
    expect(created.recipe?.ingredients?.[0]?.name).toBe('For the sauce');
    expect(created.recipe?.ingredients?.[1]?.name).toBe('For the chicken');
    expect(created.recipe?.instructions?.[0]?.instructions).toHaveLength(2);
    expect(created.recipe?.notes).toContain('Round-trip test notes');

    recipeId = created.id;
  });

  it('updates recipe fields via update_content and they persist on re-fetch', async (ctx) => {
    if (!wprmAvailable || recipeId === null) {
      ctx.skip();
      return;
    }
    const updateResult = await unifiedContentHandlers.update_content({
      content_type: 'wprm_recipe',
      id: recipeId,
      custom_fields: {
        recipe: {
          servings: '8',
          total_time: '40',
          notes: 'Updated round-trip notes',
        },
      },
    } as any);

    const updated = parseHandlerJson(updateResult);
    expect(updated.recipe?.servings).toBe('8');
    expect(updated.recipe?.total_time).toBe('40');
    expect(updated.recipe?.notes).toContain('Updated round-trip notes');

    const fetchResult = await unifiedContentHandlers.get_content({
      content_type: 'wprm_recipe',
      id: recipeId,
    } as any);
    const fetched = parseHandlerJson(fetchResult);
    expect(fetched.recipe?.servings).toBe('8');
    expect(fetched.recipe?.total_time).toBe('40');
    expect(fetched.recipe?.notes).toContain('Updated round-trip notes');
  });
});
