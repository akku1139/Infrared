import { describe, it } from 'node:test';
import assert from 'node:assert';
import { error, json, baseResponse, HTTPStatus } from './utils.ts';

describe('utils', () => {
  describe('baseResponse', () => {
    it('should create response with default CORS headers', () => {
      const response = baseResponse('test body');
      
      assert.strictEqual(response.headers.get('access-control-allow-origin'), '*');
      assert.strictEqual(response.headers.get('access-control-allow-headers'), '*');
      assert.strictEqual(response.headers.get('access-control-allow-methods'), '*');
      assert.strictEqual(response.headers.get('access-control-expose-headers'), '*');
      assert.strictEqual(response.headers.get('access-control-max-age'), '7200');
      assert.strictEqual(response.headers.get('x-robots-tag'), 'noindex');
    });

    it('should accept custom status and headers', () => {
      const response = baseResponse('test', {
        status: 201,
        headers: {
          'content-type': 'text/plain',
        },
      });
      
      assert.strictEqual(response.status, 201);
      assert.strictEqual(response.headers.get('content-type'), 'text/plain');
    });
  });

  describe('json', () => {
    it('should create JSON response with correct content-type', async () => {
      const data = { foo: 'bar' };
      const response = json(data, 200);
      
      assert.strictEqual(response.headers.get('content-type'), 'application/json');
      const body = await response.json();
      assert.deepStrictEqual(body, data);
    });

    it('should accept HTTPStatus enum', async () => {
      const response = json({ test: true }, HTTPStatus.Created);
      
      assert.strictEqual(response.status, 201);
    });
  });

  describe('error', () => {
    it('should create error response with correct structure', async () => {
      const testError = new Error('Test error message');
      const response = error(testError, 'TEST_CODE', 'test.id', 400);
      
      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.headers.get('content-type'), 'application/json');
      
      const body = await response.json() as {
        code: string;
        id: string;
        message: string;
        stack?: string;
      };
      
      assert.strictEqual(body.code, 'TEST_CODE');
      assert.strictEqual(body.id, 'test.id');
      assert.strictEqual(body.message, 'Test error message');
      assert.ok(body.stack);
    });

    it('should default to 500 status code', async () => {
      const testError = new Error('Server error');
      const response = error(testError, 'ERR', 'error.test');
      
      assert.strictEqual(response.status, 500);
    });

    it('should handle non-Error objects', async () => {
      const response = error('string error' as unknown as Error, 'CODE', 'id');
      
      assert.strictEqual(response.status, 500);
      const body = await response.json() as { message?: string };
      assert.ok(body.message);
    });
  });

  describe('HTTPStatus', () => {
    it('should have common status codes', () => {
      assert.strictEqual(HTTPStatus.OK, 200);
      assert.strictEqual(HTTPStatus.Created, 201);
      assert.strictEqual(HTTPStatus.NoContent, 204);
      assert.strictEqual(HTTPStatus.NotFound, 404);
      assert.strictEqual(HTTPStatus.InternalServerError, 500);
      assert.strictEqual(HTTPStatus.BadGateway, 502);
      assert.strictEqual(HTTPStatus.ServiceUnavailable, 503);
    });

    it('should have WebSocket status code', () => {
      assert.strictEqual(HTTPStatus.SwitchingProtocols, 101);
    });
  });
});
