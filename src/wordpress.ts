// src/wordpress.ts
import * as dotenv from 'dotenv';
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Global WordPress API client instance
let wpClient: AxiosInstance;

/**
 * Initialize the WordPress API client with authentication
 */
export async function initWordPress() {
  const apiUrl = process.env.WORDPRESS_API_URL;
  const username = process.env.WORDPRESS_USERNAME;
  const appPassword = process.env.WORDPRESS_PASSWORD;
  
  if (!apiUrl) {
    throw new Error('WordPress API URL not found in environment variables');
  }

  // Ensure the API URL has the WordPress REST API path
  let baseURL = apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`;
  
  // Add the WordPress REST API path if not already included
  if (!baseURL.includes('/wp-json/wp/v2')) {
    baseURL = baseURL + 'wp-json/wp/v2/';
  } else if (!baseURL.endsWith('/')) {
    // Ensure the URL ends with a trailing slash
    baseURL = baseURL + '/';
  }

  const config: AxiosRequestConfig = {
    baseURL,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  // Add authentication if credentials are provided
  if (username && appPassword) {
    logToFile('Adding authentication headers');
    logToFile(`Username: ${username}`);
    logToFile(`App Password: ${appPassword}`);
    
    const auth = Buffer.from(`${username}:${appPassword}`).toString('base64');
    config.headers = {
      ...config.headers,
      'Authorization': `Basic ${auth}`
    };
  }

  wpClient = axios.create(config);

  // Verify connection to WordPress API
  try {
    await wpClient.get('');
    logToFile('Successfully connected to WordPress API');
  } catch (error: any) {
    logToFile(`Failed to connect to WordPress API: ${error.message}`);
    throw new Error(`Failed to connect to WordPress API: ${error.message}`);
  }
}

// Configure logging - use fileURLToPath for cross-platform compatibility (Windows, Linux, macOS)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_DIR = path.resolve(__dirname, '../logs');
const LOG_FILE = path.join(LOG_DIR, 'wordpress-api.log');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

export function logToFile(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, logMessage);
}

/**
 * Make a request to the WordPress API
 * @param method HTTP method
 * @param endpoint API endpoint (relative to the baseURL)
 * @param data Request data
 * @param options Additional request options
 * @returns Response data
 */
export async function makeWordPressRequest(
  method: string, 
  endpoint: string, 
  data?: any, 
  options?: {
    headers?: Record<string, string>;
    isFormData?: boolean;
    rawResponse?: boolean;
  }
) {
  if (!wpClient) {
    throw new Error('WordPress client not initialized');
  }

  // Log data (skip for FormData which can't be stringified)
  if (!options?.isFormData) {
    logToFile(`Data: ${JSON.stringify(data, null, 2)}`);
  } else {
    logToFile('Request contains FormData (not shown in logs)');
  }
  
  // Handle potential leading slash in endpoint
  const path = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;

  try {
    const fullUrl = `${wpClient.defaults.baseURL}${path}`;
    
    // Prepare request config
    const requestConfig: any = {
      method,
      url: path,
      headers: options?.headers || {}
    };
    
    // Handle different data formats based on method and options
    if (method === 'GET') {
      requestConfig.params = data;
    } else if (options?.isFormData) {
      // For FormData, pass it directly without stringifying
      requestConfig.data = data;
    } else if (method === 'POST') {
      requestConfig.data = JSON.stringify(data);
    } else {
      requestConfig.data = data;
    }
    
    const requestLog = `
REQUEST:
URL: ${fullUrl}
Method: ${method}
Headers: ${JSON.stringify({...wpClient.defaults.headers, ...requestConfig.headers}, null, 2)}
Data: ${options?.isFormData ? '(FormData not shown)' : JSON.stringify(data, null, 2)}
`;
    logToFile(requestLog);

    const response = await wpClient.request(requestConfig);
    
    const responseLog = `
RESPONSE:
Status: ${response.status}
Data: ${JSON.stringify(response.data, null, 2)}
`;
    logToFile(responseLog);
    
    return options?.rawResponse ? response : response.data;
  } catch (error: any) {
    const errorLog = `
ERROR:
Message: ${error.message}
Status: ${error.response?.status || 'N/A'}
Data: ${JSON.stringify(error.response?.data || {}, null, 2)}
`;
    console.error(errorLog);
    logToFile(errorLog);
    throw error;
  }
}

/**
 * Make a request to the WordPress.org Plugin Repository API
 * @param searchQuery Search query string
 * @param page Page number (1-based)
 * @param perPage Number of results per page
 * @returns Response data from WordPress.org Plugin API
 */
export async function searchWordPressPluginRepository(searchQuery: string, page: number = 1, perPage: number = 10) {
  try {
    // WordPress.org Plugin API endpoint
    const apiUrl = 'https://api.wordpress.org/plugins/info/1.2/';
    
    // Build the request data according to WordPress.org Plugin API format
    const requestData = {
      action: 'query_plugins',
      request: {
        search: searchQuery,
        page: page,
        per_page: perPage,
        fields: {
          description: true,
          sections: false,
          tested: true,
          requires: true,
          rating: true,
          ratings: false,
          downloaded: true,
          downloadlink: true,
          last_updated: true,
          homepage: true,
          tags: true
        }
      }
    };
    
    const requestLog = `
WORDPRESS.ORG PLUGIN API REQUEST:
URL: ${apiUrl}
Method: GET
Params: ${JSON.stringify(requestData, null, 2)}
`;
    logToFile(requestLog);
    
    // WordPress.org Plugin API requires GET requests with serialized query parameters
    const response = await axios.get(apiUrl, {
      params: requestData,
      paramsSerializer: (params) => {
        // Serialize nested objects properly for WordPress.org API
        // Format: action=query_plugins&request[search]=term&request[page]=1
        const flatParams = new URLSearchParams();
        flatParams.append('action', params.action);
        
        Object.keys(params.request).forEach(key => {
          const value = params.request[key];
          if (typeof value === 'object' && value !== null) {
            // Handle nested objects like fields
            Object.keys(value).forEach(subKey => {
              flatParams.append(`request[${key}][${subKey}]`, String(value[subKey]));
            });
          } else {
            flatParams.append(`request[${key}]`, String(value));
          }
        });
        
        return flatParams.toString();
      }
    });
    
    const responseLog = `
WORDPRESS.ORG PLUGIN API RESPONSE:
Status: ${response.status}
Info: ${JSON.stringify(response.data.info, null, 2)}
Plugins Count: ${response.data.plugins?.length || 0}
`;
    logToFile(responseLog);
    
    return response.data;
  } catch (error: any) {
    const errorLog = `
WORDPRESS.ORG PLUGIN API ERROR:
Message: ${error.message}
Status: ${error.response?.status || 'N/A'}
Data: ${JSON.stringify(error.response?.data || {}, null, 2)}
`;
    console.error(errorLog);
    logToFile(errorLog);
    throw error;
  }
}