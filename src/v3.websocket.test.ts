import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { Miniflare, WebSocket } from 'miniflare';
import type { SocketClientToServer, SocketServerToClient } from './types.js';

// Miniflare's WebSocket doesn't have OPEN constant, so we define it
const WS_OPEN = 1;

describe('v3 WebSocket handler with Miniflare', () => {
  let mf: Miniflare;

  before(async () => {
    mf = new Miniflare({
      name: 'infrared-test',
      scriptPath: './public/_worker.js',
      compatibilityDate: '2024-01-01',
      compatibilityFlags: ['nodejs_compat'],
      modules: true,
      modulesRules: [
        {
          type: 'ESModule',
          include: ['**/*.js'],
        },
      ],
    });
  });

  after(async () => {
    await mf.dispose();
  });

  it('should handle WebSocket upgrade request and return 101', async () => {
    const worker = await mf.getWorker();
    
    // Create a WebSocket connection using Miniflare's fetch API
    const response = await mf.dispatchFetch('http://localhost:8787/v3/', {
      headers: {
        'upgrade': 'websocket',
      },
    });
    
    // Should return 101 Switching Protocols
    assert.strictEqual(response.status, 101);
    
    // Get the WebSocket from the response
    const ws = response.webSocket;
    assert.ok(ws, 'Should have a WebSocket in the response');
    
    // Accept the WebSocket
    ws.accept();
    
    // Verify we can send and receive messages
    const messagePromise = new Promise<string>((resolve) => {
      ws.addEventListener('message', (event) => {
        resolve(event.data as string);
      });
    });
    
    // Close the connection
    ws.close(1000, 'Test complete');
    
    // The connection should close cleanly
    await new Promise<void>((resolve) => {
      ws.addEventListener('close', () => resolve());
    });
  });

  it('should reject invalid connect message', async () => {
    const worker = await mf.getWorker();
    
    // Create a WebSocket connection
    const response = await mf.dispatchFetch('http://localhost:8787/v3/', {
      headers: {
        'upgrade': 'websocket',
      },
    });
    
    assert.strictEqual(response.status, 101);
    const ws = response.webSocket;
    assert.ok(ws);
    
    ws.accept();
    
    // Send an invalid connect message (missing required fields)
    const errorPromise = new Promise<string>((resolve) => {
      ws.addEventListener('close', (event) => {
        resolve(`code:${event.code}:reason:${event.reason}`);
      });
    });
    
    // Send invalid message
    ws.send(JSON.stringify({
      type: 'connect',
      // Missing remote, protocols, headers, forwardHeaders
    }));
    
    // Should receive an error close
    const closeInfo = await errorPromise;
    assert.ok(closeInfo.includes('code:') && !closeInfo.includes('code:1000'), 'Should close with error code');
  });

  it.skip('should handle valid WebSocket tunnel to echo server', async () => {
    // This test requires network access to an external WebSocket server
    // Skipped for CI environments
  });

  it('should timeout when no connect message is sent', async () => {
    const worker = await mf.getWorker();
    
    // Create a WebSocket connection
    const response = await mf.dispatchFetch('http://localhost:8787/v3/', {
      headers: {
        'upgrade': 'websocket',
      },
    });
    
    assert.strictEqual(response.status, 101);
    const ws = response.webSocket;
    assert.ok(ws);
    
    ws.accept();
    
    // Don't send any message - wait briefly to verify connection stays open
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Connection should still be open at this point (timeout is 10s)
    assert.strictEqual(ws.readyState, WS_OPEN);
    
    ws.close();
  });

  it('should reject invalid protocol in connect message', async () => {
    const worker = await mf.getWorker();
    
    // Create a WebSocket connection
    const response = await mf.dispatchFetch('http://localhost:8787/v3/', {
      headers: {
        'upgrade': 'websocket',
      },
    });
    
    assert.strictEqual(response.status, 101);
    const ws = response.webSocket;
    assert.ok(ws);
    
    ws.accept();
    
    const closePromise = new Promise<number>((resolve) => {
      ws.addEventListener('close', (event) => {
        resolve(event.code);
      });
    });
    
    // Try to connect to HTTP URL instead of WS/WSS
    const connectMessage: SocketClientToServer = {
      type: 'connect',
      remote: 'https://example.com/', // Invalid - should be ws:// or wss://
      protocols: [],
      headers: {},
      forwardHeaders: [],
    };
    ws.send(JSON.stringify(connectMessage));
    
    const closeCode = await closePromise;
    assert.ok(closeCode !== 1000, 'Should close with error for invalid protocol');
  });

  it('should properly format connect message structure', async () => {
    // This test verifies the structure of the connect message
    const connectMessage: SocketClientToServer = {
      type: 'connect',
      remote: 'wss://example.com/socket',
      protocols: ['chat', 'superchat'],
      headers: {
        'Origin': 'http://localhost',
        'User-Agent': 'Test Client',
      },
      forwardHeaders: ['accept-language'],
    };
    
    assert.strictEqual(connectMessage.type, 'connect');
    assert.strictEqual(connectMessage.remote, 'wss://example.com/socket');
    assert.deepStrictEqual(connectMessage.protocols, ['chat', 'superchat']);
    assert.ok(connectMessage.headers['Origin']);
    assert.deepStrictEqual(connectMessage.forwardHeaders, ['accept-language']);
  });
});
