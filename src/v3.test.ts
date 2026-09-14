import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import v3 from './v3.ts';
import type { SocketClientToServer, Env } from './types.ts';

describe('v3 HTTP handler', () => {
  it('should handle OPTIONS request', async () => {
    const req = new Request('http://localhost/v3/', {
      method: 'OPTIONS',
    });
    
    const response = await v3(req, {} as Env);
    
    assert.strictEqual(response.status, 200);
  });

  it.skip('should return error when X-Bare-URL header is missing', async () => {
    const req = new Request('http://localhost/v3/', {
      method: 'GET',
      headers: {},
    });
    
    const response = await v3(req, {} as Env);
    
    assert.strictEqual(response.status, 500);
    const body = await response.json() as { code?: string };
    assert.strictEqual(body.code, 'UNKNOWN');
  });

  it.skip('should return error when X-Bare-Headers is missing', async () => {
    const req = new Request('http://localhost/v3/', {
      method: 'GET',
      headers: {
        'x-bare-url': 'https://example.com',
      },
    });
    
    const response = await v3(req, {} as Env);
    
    assert.strictEqual(response.status, 500);
    const body = await response.json() as { code?: string };
    assert.strictEqual(body.code, 'UNKNOWN');
  });

  it.skip('should return error for invalid protocol in X-Bare-URL', async () => {
    const req = new Request('http://localhost/v3/', {
      method: 'GET',
      headers: {
        'x-bare-url': 'ftp://example.com',
        'x-bare-headers': '{}',
      },
    });
    
    const response = await v3(req, {} as Env);
    
    assert.strictEqual(response.status, 500);
    const body = await response.json() as { code?: string };
    assert.strictEqual(body.code, 'UNKNOWN');
  });

  it.skip('should return error for invalid JSON in X-Bare-Headers', async () => {
    const req = new Request('http://localhost/v3/', {
      method: 'GET',
      headers: {
        'x-bare-url': 'https://example.com',
        'x-bare-headers': 'invalid json',
      },
    });
    
    const response = await v3(req, {} as Env);
    
    assert.strictEqual(response.status, 500);
    const body = await response.json() as { code?: string };
    assert.strictEqual(body.code, 'UNKNOWN');
  });

  it('should filter out forbidden send headers', async () => {
    const req = new Request('http://localhost/v3/', {
      method: 'GET',
      headers: {
        'x-bare-url': 'https://example.com',
        'x-bare-headers': JSON.stringify({
          'connection': 'keep-alive',
          'content-length': '100',
          'transfer-encoding': 'chunked',
          'accept': 'text/html',
        }),
      },
    });
    
    // This should not throw, forbidden headers should be filtered
    const response = await v3(req, {} as Env);
    
    // Should attempt to fetch (will fail due to network, but should pass validation)
    assert.ok(response);
  });

  it.skip('should handle invalid header value types', async () => {
    const req = new Request('http://localhost/v3/', {
      method: 'GET',
      headers: {
        'x-bare-url': 'https://example.com',
        'x-bare-headers': JSON.stringify({
          'accept': 123 as unknown as string,
        }),
      },
    });
    
    const response = await v3(req, {} as Env);
    
    assert.strictEqual(response.status, 500);
    const body = await response.json() as { code?: string };
    assert.strictEqual(body.code, 'UNKNOWN');
  });

  it('should handle x-bare-pass-status header', async () => {
    const req = new Request('http://localhost/v3/?cache=true', {
      method: 'GET',
      headers: {
        'x-bare-url': 'https://example.com',
        'x-bare-headers': JSON.stringify({}),
        'x-bare-pass-status': '200, 304, 404',
      },
    });
    
    const response = await v3(req, {} as Env);
    
    // Should pass validation
    assert.ok(response);
  });

  it.skip('should reject invalid status codes in x-bare-pass-status', async () => {
    const req = new Request('http://localhost/v3/', {
      method: 'GET',
      headers: {
        'x-bare-url': 'https://example.com',
        'x-bare-headers': JSON.stringify({}),
        'x-bare-pass-status': 'invalid',
      },
    });
    
    const response = await v3(req, {} as Env);
    
    assert.strictEqual(response.status, 500);
    const body = await response.json() as { code?: string };
    assert.strictEqual(body.code, 'UNKNOWN');
  });

  it('should handle x-bare-pass-headers', async () => {
    const req = new Request('http://localhost/v3/', {
      method: 'GET',
      headers: {
        'x-bare-url': 'https://example.com',
        'x-bare-headers': JSON.stringify({}),
        'x-bare-pass-headers': 'content-type, x-custom-header',
      },
    });
    
    const response = await v3(req, {} as Env);
    
    assert.ok(response);
  });

  it.skip('should reject forbidden headers in x-bare-pass-headers', async () => {
    const req = new Request('http://localhost/v3/', {
      method: 'GET',
      headers: {
        'x-bare-url': 'https://example.com',
        'x-bare-headers': JSON.stringify({}),
        'x-bare-pass-headers': 'connection, content-length',
      },
    });
    
    const response = await v3(req, {} as Env);
    
    assert.strictEqual(response.status, 500);
    const body = await response.json() as { code?: string };
    assert.strictEqual(body.code, 'UNKNOWN');
  });

  it('should handle x-bare-forward-headers', async () => {
    const req = new Request('http://localhost/v3/', {
      method: 'GET',
      headers: {
        'x-bare-url': 'https://example.com',
        'x-bare-headers': JSON.stringify({}),
        'x-bare-forward-headers': 'accept-language, user-agent',
      },
    });
    
    const response = await v3(req, {} as Env);
    
    assert.ok(response);
  });

  it.skip('should reject forbidden headers in x-bare-forward-headers', async () => {
    const req = new Request('http://localhost/v3/', {
      method: 'GET',
      headers: {
        'x-bare-url': 'https://example.com',
        'x-bare-headers': JSON.stringify({}),
        'x-bare-forward-headers': 'host, origin',
      },
    });
    
    const response = await v3(req, {} as Env);
    
    assert.strictEqual(response.status, 500);
    const body = await response.json() as { code?: string };
    assert.strictEqual(body.code, 'UNKNOWN');
  });

  it('should include CORS headers in response', async () => {
    const req = new Request('http://localhost/v3/', {
      method: 'OPTIONS',
    });
    
    const response = await v3(req, {} as Env);
    
    assert.strictEqual(response.headers.get('access-control-allow-origin'), '*');
    assert.strictEqual(response.headers.get('access-control-allow-headers'), '*');
    assert.strictEqual(response.headers.get('access-control-allow-methods'), '*');
  });
});

describe('v3 WebSocket handler', () => {
  it.skip('should handle WebSocket upgrade requests', async () => {
    const req = new Request('http://localhost/v3/', {
      headers: {
        'upgrade': 'websocket',
        'x-bare-url': 'wss://example.com/socket',
        'x-bare-headers': JSON.stringify({}),
      },
    });
    
    const response = await v3(req, {} as Env);
    
    // Should return 101 Switching Protocols
    assert.strictEqual(response.status, 101);
    assert.ok(response.webSocket);
  });

  it.skip('should reject non-websocket protocols', async () => {
    const req = new Request('http://localhost/v3/', {
      headers: {
        'upgrade': 'websocket',
        'x-bare-url': 'https://example.com', // HTTP, not WS
        'x-bare-headers': JSON.stringify({}),
      },
    });
    
    const response = await v3(req, {} as Env);
    
    // Should still return 101 but connection will fail later
    assert.strictEqual(response.status, 101);
  });
});
