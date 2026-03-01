/**
 * HTTP/HTTPS proxy support for outbound connections.
 * Supports both environment variables and database settings.
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';
import { getSetting } from './db';

/**
 * Get proxy URL from settings or environment variables.
 */
function getProxyUrl(): string | undefined {
  // Use environment variables first (set when starting the server)
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  if (proxyUrl) {
    console.log('[proxy] Using env proxy:', proxyUrl);
    return proxyUrl;
  }
  
  // Fall back to database settings
  try {
    const enabled = getSetting('bridge_proxy_enabled');
    if (enabled === 'true') {
      const host = getSetting('bridge_proxy_host');
      const port = getSetting('bridge_proxy_port');
      if (host && port) {
        console.log('[proxy] Using database proxy:', `http://${host}:${port}`);
        return `http://${host}:${port}`;
      }
    }
  } catch (e) {
    // Database not available
  }
  return undefined;
}

/**
 * Create a custom fetch that supports HTTP proxy CONNECT tunneling.
 */
export async function proxyFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const proxyUrl = getProxyUrl();
  
  if (!proxyUrl) {
    // No proxy, use native fetch
    return fetch(url, options);
  }

  const targetUrl = new URL(url);
  const isHttps = targetUrl.protocol === 'https:';
  
  console.log('[proxy] Proxying request to:', url);

  return new Promise((resolve, reject) => {
    const proxyParts = new URL(proxyUrl);
    const proxyOptions = {
      hostname: proxyParts.hostname,
      port: proxyParts.port || (proxyParts.protocol === 'https:' ? 443 : 80),
      method: 'CONNECT',
      path: `${targetUrl.host}:${targetUrl.port || (isHttps ? 443 : 80)}`,
      timeout: 30000
    };

    const req = http.request(proxyOptions);

    req.on('connect', (res, socket, head) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Proxy connection failed: ${res.statusCode}`));
        return;
      }

      // Tunnel established, now make the actual request
      if (isHttps) {
        const httpsReq = https.request({
          hostname: targetUrl.hostname,
          port: targetUrl.port || 443,
          path: targetUrl.pathname + targetUrl.search,
          method: options.method || 'GET',
          headers: options.headers as Record<string, string>,
          socket: socket
        }, (httpsRes) => {
          let data = '';
          httpsRes.on('data', chunk => data += chunk);
          httpsRes.on('end', () => {
            // Build a minimal Response-like object
            resolve(new Response(data, {
              status: httpsRes.statusCode,
              statusText: httpsRes.statusMessage,
              headers: httpsRes.headers as Record<string, string>
            }));
          });
        });

        httpsReq.on('error', reject);
        
        if (options.body) {
          httpsReq.write(options.body);
        }
        httpsReq.end();
      } else {
        const httpReq = http.request({
          hostname: targetUrl.hostname,
          port: targetUrl.port || 80,
          path: targetUrl.pathname + targetUrl.search,
          method: options.method || 'GET',
          headers: options.headers as Record<string, string>,
          socket: socket
        }, (httpRes) => {
          let data = '';
          httpRes.on('data', chunk => data += chunk);
          httpRes.on('end', () => {
            resolve(new Response(data, {
              status: httpRes.statusCode,
              statusText: httpRes.statusMessage,
              headers: httpRes.headers as Record<string, string>
            }));
          });
        });

        httpReq.on('error', reject);
        
        if (options.body) {
          httpReq.write(options.body);
        }
        httpReq.end();
      }
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Proxy connection timeout'));
    });
    
    req.end();
  });
  
  // Add timeout handler
  setTimeout(() => {
    req.destroy();
    reject(new Error('Proxy request timeout'));
  }, 15000);
}

/**
 * Simple proxy agent fallback - just logs and returns undefined
 * (actual proxy handling is done in proxyFetch)
 */
export function getProxyAgent(): undefined {
  return undefined;
}
