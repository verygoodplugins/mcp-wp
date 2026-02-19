#!/usr/bin/env node
// src/server.ts
import * as dotenv from 'dotenv';
dotenv.config(); // Load environment variables from .env first

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { allTools, toolHandlers } from './tools/index.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';


// Create MCP server instance
const server = new McpServer({
    name: "wordpress",
    version: "0.0.1"
}, {
    capabilities: {
        tools: allTools.reduce((acc, tool) => {
            acc[tool.name] = tool;
            return acc;
        }, {} as Record<string, any>)
    }
});

// Register each tool from our tools list with its corresponding handler
for (const tool of allTools) {
    const handler = toolHandlers[tool.name as keyof typeof toolHandlers];
    if (!handler) continue;
    
    const wrappedHandler = async (args: any) => {
        // The handler functions are already typed with their specific parameter types
        const result = await handler(args);
        return {
            content: result.toolResult.content.map((item: { type: string; text: string }) => ({
                ...item,
                type: "text" as const
            })),
            isError: result.toolResult.isError
        };
    };
    
    // console.log(`Registering tool: ${tool.name}`);
    // console.log(`Input schema: ${JSON.stringify(tool.inputSchema)}`);

    // const zodSchema = z.any().optional();
    // const jsonSchema = zodToJsonSchema(z.object(tool.inputSchema.properties as z.ZodRawShape));

    // const schema = z.object(tool.inputSchema as z.ZodRawShape).catchall(z.unknown());
    
    // The inputSchema is already in JSON Schema format with properties
    // server.tool(tool.name, tool.inputSchema.shape, wrappedHandler);
    // const zodSchema = z.any().optional();
    // const jsonSchema = zodToJsonSchema(z.object(tool.inputSchema.properties as z.ZodRawShape));
    // const parsedSchema = z.any().optional().parse(jsonSchema);

    const zodSchema = z.object(tool.inputSchema.properties as z.ZodRawShape); 
    server.tool(tool.name, zodSchema.shape, wrappedHandler)

}

async function main() {
    const { logToFile } = await import('./wordpress.js');
    
    // Log startup info to stderr (MCP protocol uses stdout)
    logToFile('Starting WordPress MCP server...', 'info');
    logToFile(`Node version: ${process.version}`, 'info');
    logToFile(`Working directory: ${process.cwd()}`, 'info');

    try {
        logToFile('Initializing WordPress client...');
        const { initWordPress } = await import('./wordpress.js');
        await initWordPress();
        logToFile('WordPress client initialized successfully.');

        logToFile('Setting up server transport...');
        const transport = new StdioServerTransport();
        await server.connect(transport);
        logToFile('WordPress MCP Server running on stdio');
        logToFile(`Registered ${allTools.length} tools`);
    } catch (error: any) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        logToFile(`Failed to initialize server: ${errorMessage}`);
        if (errorStack) {
            logToFile(`Stack trace: ${errorStack}`);
        }
        process.exit(1);
    }
}

// Handle process signals and errors
// IMPORTANT: MCP uses stdout for JSON-RPC — never use console.log here
process.on('SIGTERM', () => {
    process.stderr.write('[SHUTDOWN] Received SIGTERM, shutting down...\n');
    process.exit(0);
});
process.on('SIGINT', () => {
    process.stderr.write('[SHUTDOWN] Received SIGINT, shutting down...\n');
    process.exit(0);
});
process.on('uncaughtException', (error) => {
    process.stderr.write(`[FATAL] Uncaught exception: ${error}\n`);
    process.exit(1);
});
process.on('unhandledRejection', (error) => {
    process.stderr.write(`[FATAL] Unhandled rejection: ${error}\n`);
    process.exit(1);
});

main().catch((error) => {
    process.stderr.write(`[FATAL] Startup error: ${error}\n`);
    process.exit(1);
});