import { describe, it, expect } from 'vitest';
import { allTools, toolHandlers } from '../../src/tools/index.js';

describe('tool registry wiring', () => {
  it('exposes at least one tool', () => {
    expect(allTools.length).toBeGreaterThan(0);
  });

  it('has a handler for every registered tool', () => {
    const handlerNames = new Set(Object.keys(toolHandlers));
    const missing = allTools.map((t) => t.name).filter((name) => !handlerNames.has(name));
    expect(missing).toEqual([]);
  });

  it('has no orphan handlers without a corresponding tool definition', () => {
    const toolNames = new Set(allTools.map((t) => t.name));
    const orphans = Object.keys(toolHandlers).filter((name) => !toolNames.has(name));
    expect(orphans).toEqual([]);
  });

  it('has unique tool names', () => {
    const counts = new Map<string, number>();
    for (const tool of allTools) {
      counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
    }
    const duplicates = [...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name);
    expect(duplicates).toEqual([]);
  });

  it('has a non-empty name and description on every tool', () => {
    for (const tool of allTools) {
      expect(tool.name, 'tool name').toBeTruthy();
      expect(tool.description, `description for ${tool.name}`).toBeTruthy();
    }
  });

  it('declares an object inputSchema with a properties record on every tool', () => {
    for (const tool of allTools) {
      expect(tool.inputSchema, `inputSchema for ${tool.name}`).toBeDefined();
      expect(tool.inputSchema.type, `inputSchema.type for ${tool.name}`).toBe('object');
      expect(
        typeof tool.inputSchema.properties,
        `inputSchema.properties for ${tool.name}`,
      ).toBe('object');
      expect(tool.inputSchema.properties, `inputSchema.properties for ${tool.name}`).not.toBeNull();
    }
  });

  it('exposes each handler as a function', () => {
    for (const [name, handler] of Object.entries(toolHandlers)) {
      expect(typeof handler, `handler ${name}`).toBe('function');
    }
  });
});
