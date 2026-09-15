/**
 * Bare Client V3 Implementation
 * Based on Ultraviolet and Scramjet specifications
 * https://github.com/titaniumnetwork-dev/Ultraviolet
 * https://github.com/MercuryWorkshop/scramjet
 */

class BareClient {
  constructor(bareServerUrl) {
    this.bareServer = bareServerUrl.endsWith('/') ? bareServerUrl.slice(0, -1) : bareServerUrl;
    this.version = 'v3';
    this.baseEndpoint = `${this.bareServer}/${this.version}`;
  }

  /**
   * Send an HTTP request through the Bare server
   * @param {string} url - The target URL to fetch
   * @param {RequestInit} options - Fetch options
   * @returns {Promise<BareResponse>}
   */
  async fetch(url, options = {}) {
    const { method = 'GET', headers = {}, body = null, cache = false } = options;
    
    // Prepare Bare-specific headers
    const bareHeaders = {};
    const forwardHeaders = [];
    
    // Separate standard headers from Bare control headers
    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();
      
      if (lowerKey.startsWith('x-bare-')) {
        // These are control headers, don't send them to remote
        continue;
      }
      
      bareHeaders[key] = value;
    }
    
    // Build the request URL with cache parameter if needed
    const requestUrl = new URL(this.baseEndpoint);
    if (cache) {
      requestUrl.searchParams.set('cache', 'true');
    }
    
    // Prepare the fetch request
    const fetchOptions = {
      method,
      headers: {
        'X-Bare-URL': url,
        'X-Bare-Headers': JSON.stringify(bareHeaders),
        ...options.headers,
      },
    };
    
    if (body && method !== 'GET' && method !== 'HEAD') {
      fetchOptions.body = body;
    }
    
    const response = await fetch(requestUrl.toString(), fetchOptions);
    
    // Parse Bare response headers
    const bareStatus = response.headers.get('X-Bare-Status');
    const bareStatusText = response.headers.get('X-Bare-Status-Text');
    const bareHeadersStr = response.headers.get('X-Bare-Headers');
    
    const responseHeaders = new Headers();
    if (bareHeadersStr) {
      const parsed = JSON.parse(bareHeadersStr);
      for (const [key, value] of Object.entries(parsed)) {
        if (Array.isArray(value)) {
          for (const v of value) {
            responseHeaders.append(key, v);
          }
        } else {
          responseHeaders.set(key, value);
        }
      }
    }
    
    return new BareResponse(response.body, {
      status: bareStatus ? parseInt(bareStatus, 10) : response.status,
      statusText: bareStatusText || undefined,
      headers: responseHeaders,
    });
  }

  /**
   * Establish a WebSocket connection through the Bare server
   * @param {string} url - WebSocket URL to connect to
   * @param {string[]} protocols - WebSocket subprotocols
   * @returns {BareWebSocket}
   */
  websocket(url, protocols = []) {
    const wsUrl = this.baseEndpoint.replace(/^http/, 'ws');
    
    // Create the actual WebSocket connection to the Bare server
    const socket = new WebSocket(wsUrl);
    
    // Wrap it in our BareWebSocket class
    const bareWs = new BareWebSocket(socket, url, protocols);
    
    return bareWs;
  }
}

/**
 * Wrapper for Response that handles Bare protocol specifics
 */
class BareResponse {
  constructor(body, init = {}) {
    this._body = body;
    this.status = init.status || 200;
    this.statusText = init.statusText || 'OK';
    this.headers = init.headers || new Headers();
    this.ok = this.status >= 200 && this.status < 300;
  }

  get body() {
    return this._body;
  }

  async text() {
    return new TextDecoder().decode(await this.arrayBuffer());
  }

  async json() {
    return JSON.parse(await this.text());
  }

  async arrayBuffer() {
    if (!this._body) return new ArrayBuffer(0);
    return new Response(this._body).arrayBuffer();
  }

  async blob() {
    if (!this._body) return new Blob();
    return new Response(this._body).blob();
  }

  clone() {
    return new BareResponse(this._body, {
      status: this.status,
      statusText: this.statusText,
      headers: new Headers(this.headers),
    });
  }
}

/**
 * Wrapper for WebSocket connections through Bare server
 * Implements the Bare V3 WebSocket protocol
 */
class BareWebSocket extends EventTarget {
  constructor(socket, remoteUrl, protocols = []) {
    super();
    
    this._socket = socket;
    this._remoteUrl = remoteUrl;
    this._protocols = protocols;
    this.readyState = WebSocket.CONNECTING;
    this.binaryType = 'blob';
    this.extensions = '';
    this.protocol = '';
    
    // Bind event handlers
    this._socket.addEventListener('open', this._handleOpen.bind(this));
    this._socket.addEventListener('message', this._handleMessage.bind(this));
    this._socket.addEventListener('close', this._handleClose.bind(this));
    this._socket.addEventListener('error', this._handleError.bind(this));
  }

  _handleOpen(event) {
    // Send the connect message as per Bare V3 spec
    const connectMessage = {
      type: 'connect',
      remote: this._remoteUrl,
      protocols: this._protocols,
      headers: {},
      forwardHeaders: ['user-agent', 'origin', 'referer'],
    };
    
    this._socket.send(JSON.stringify(connectMessage));
  }

  _handleMessage(event) {
    try {
      const data = JSON.parse(event.data);
      
      if (data.type === 'open') {
        // Server confirmed connection
        this.readyState = WebSocket.OPEN;
        this.protocol = data.protocol || '';
        
        // Handle set-cookies if present
        if (data.setCookies && data.setCookies.length > 0) {
          console.log('Received cookies:', data.setCookies);
        }
        
        // Trigger open event
        this.dispatchEvent(new Event('open'));
      } else if (data.type === 'message') {
        // Regular message from remote
        const messageData = data.data;
        this.dispatchEvent(new MessageEvent('message', { 
          data: messageData,
          origin: this._remoteUrl,
        }));
      } else if (data.type === 'close') {
        // Remote closed connection
        this.readyState = WebSocket.CLOSING;
        this.dispatchEvent(new CloseEvent('close', {
          code: data.code || 1000,
          reason: data.reason || '',
          wasClean: true,
        }));
        this.readyState = WebSocket.CLOSED;
      } else if (data.type === 'error') {
        // Error from server
        this.dispatchEvent(new Event('error'));
      }
    } catch (e) {
      // If parsing fails, might be raw data passthrough
      this.dispatchEvent(new MessageEvent('message', { 
        data: event.data,
        origin: this._remoteUrl,
      }));
    }
  }

  _handleClose(event) {
    if (this.readyState !== WebSocket.CLOSED) {
      this.readyState = WebSocket.CLOSED;
      this.dispatchEvent(new CloseEvent('close', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      }));
    }
  }

  _handleError(event) {
    this.dispatchEvent(new Event('error'));
  }

  send(data) {
    if (this.readyState !== WebSocket.OPEN) {
      throw new DOMException('WebSocket is not open', 'InvalidStateError');
    }
    
    // Send as string or binary based on type
    if (typeof data === 'string') {
      this._socket.send(data);
    } else if (data instanceof Blob) {
      data.arrayBuffer().then(buffer => {
        this._socket.send(buffer);
      });
    } else if (data instanceof ArrayBuffer) {
      this._socket.send(data);
    } else if (ArrayBuffer.isView(data)) {
      this._socket.send(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    } else {
      this._socket.send(String(data));
    }
  }

  close(code = 1000, reason = '') {
    if (this.readyState === WebSocket.OPEN) {
      const closeMessage = {
        type: 'close',
        code,
        reason,
      };
      this._socket.send(JSON.stringify(closeMessage));
    }
    this._socket.close(code, reason);
  }
}

// Export for different module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BareClient, BareResponse, BareWebSocket };
}

if (typeof window !== 'undefined') {
  window.BareClient = BareClient;
  window.BareResponse = BareResponse;
  window.BareWebSocket = BareWebSocket;
}
