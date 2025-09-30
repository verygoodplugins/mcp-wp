// src/tools/sql-query.ts
import { z } from 'zod';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { makeWordPressRequest } from '../wordpress.js';

// Schema for SQL query execution
const executeSqlQuerySchema = z.object({
  query: z.string().describe('SQL query to execute (SELECT queries only for safety)')
});

// Type definition
type ExecuteSqlQueryParams = z.infer<typeof executeSqlQuerySchema>;

// Tools
export const sqlQueryTools: Tool[] = [
  {
    name: 'execute_sql_query',
    description: 'Execute a SQL query against the WordPress database. For safety, only SELECT queries are allowed. Requires the WP Fusion Database Query endpoint to be enabled.',
    inputSchema: {
      type: 'object',
      properties: executeSqlQuerySchema.shape,
      required: ['query']
    }
  }
];

// Handlers
export const sqlQueryHandlers = {
  execute_sql_query: async (params: ExecuteSqlQueryParams) => {
    try {
      // Validate that it's a SELECT query for safety
      const trimmedQuery = params.query.trim().toUpperCase();
      
      if (!trimmedQuery.startsWith('SELECT')) {
        return {
          toolResult: {
            content: [{
              type: 'text' as const,
              text: 'Error: Only SELECT queries are allowed for safety reasons. Please use a SELECT statement.'
            }],
            isError: true
          }
        };
      }

      // Check for dangerous patterns
      const dangerousPatterns = [
        /DROP\s+/i,
        /DELETE\s+/i,
        /UPDATE\s+/i,
        /INSERT\s+/i,
        /TRUNCATE\s+/i,
        /ALTER\s+/i,
        /CREATE\s+/i,
        /GRANT\s+/i,
        /REVOKE\s+/i
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(params.query)) {
          return {
            toolResult: {
              content: [{
                type: 'text' as const,
                text: `Error: Query contains potentially dangerous SQL statement. Only SELECT queries are allowed.`
              }],
              isError: true
            }
          };
        }
      }

      // Execute the query via the custom WP Fusion endpoint
      const response = await makeWordPressRequest(
        'POST',
        '/wp-fusion/v1/query',
        { query: params.query }
      );

      return {
        toolResult: {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(response, null, 2)
          }]
        }
      };

    } catch (error: any) {
      // Check if it's a 404 error (endpoint not found)
      if (error.response?.status === 404) {
        return {
          toolResult: {
            content: [{
              type: 'text' as const,
              text: `Error: SQL query endpoint not found. Please ensure the WP Fusion Database Query endpoint is enabled in your WordPress installation.

To enable this feature, add the following code to your WordPress site (via a custom plugin or theme functions.php):

add_action('rest_api_init', function() {
    register_rest_route('wp-fusion/v1', '/query', array(
        'methods' => 'POST',
        'callback' => function($request) {
            global $wpdb;
            
            $query = $request->get_param('query');
            
            // Additional security check
            if (!current_user_can('manage_options')) {
                return new WP_Error('unauthorized', 'Unauthorized', array('status' => 401));
            }
            
            // Only allow SELECT queries
            if (stripos(trim($query), 'SELECT') !== 0) {
                return new WP_Error('invalid_query', 'Only SELECT queries allowed', array('status' => 400));
            }
            
            $results = $wpdb->get_results($query, ARRAY_A);
            
            if ($wpdb->last_error) {
                return new WP_Error('query_error', $wpdb->last_error, array('status' => 400));
            }
            
            return array(
                'results' => $results,
                'num_rows' => count($results)
            );
        },
        'permission_callback' => function() {
            return current_user_can('manage_options');
        }
    ));
});`
            }],
            isError: true
          }
        };
      }

      return {
        toolResult: {
          content: [{
            type: 'text' as const,
            text: `Error executing SQL query: ${error.message}`
          }],
          isError: true
        }
      };
    }
  }
};
