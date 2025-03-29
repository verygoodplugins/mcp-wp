// src/wordpress.ts
import * as dotenv from 'dotenv';
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import * as fs from 'fs';
import * as path from 'path';

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

  // Ensure the API URL ends with trailing slash
  const baseURL = apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`;

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

// Configure logging
const META_URL = import.meta.url.replace(/^file:/, '');
const LOG_DIR = path.join(META_URL.split('/').slice(0, -1).join('/'), '../logs');
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
 * @returns Response data
 */
export async function makeWordPressRequest(method: string, endpoint: string, data?: any) {
  if (!wpClient) {
    throw new Error('WordPress client not initialized');
  }

  // Log data 
  logToFile(`Data: ${JSON.stringify(data, null, 2)}`);
  
  // Handle potential leading slash in endpoint
  const path = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;

  try {
    const fullUrl = `${wpClient.defaults.baseURL}${path}`;
    const requestLog = `
REQUEST:
URL: ${fullUrl}
Method: ${method}
Headers: ${JSON.stringify(wpClient.defaults.headers, null, 2)}
Data: ${JSON.stringify(data, null, 2)}
`;
    logToFile(requestLog);

    const response = await wpClient.request({
      method,
      url: path,
      params: method === 'GET' ? data : undefined,
      data: method === 'POST' ? JSON.stringify(data) : method !== 'GET' ? data : undefined,
    });
    
    const responseLog = `
RESPONSE:
Status: ${response.status}
Data: ${JSON.stringify(response.data, null, 2)}
`;
    logToFile(responseLog);
    
    return response.data;
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
Data: ${JSON.stringify(requestData, null, 2)}
`;
    logToFile(requestLog);
    
    const response = await axios.post(apiUrl, requestData, {
      headers: {
        'Content-Type': 'application/json'
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