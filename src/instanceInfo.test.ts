import { describe, it } from 'node:test';
import assert from 'node:assert';
import instanceInfo from './instanceInfo.ts';
import type { Env } from './types.ts';

describe('instanceInfo', () => {
  it('should return instance information', async () => {
    const req = new Request('http://localhost/');
    
    const response = await instanceInfo(req, {} as Env);
    
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('content-type'), 'application/json');
    
    const body = await response.json() as {
      versions: string[];
      language: string;
      project: {
        name: string;
        repository: string;
        version: string;
      };
    };
    
    assert.ok(body.versions);
    assert.ok(Array.isArray(body.versions));
    assert.ok(body.versions.includes('v3'));
    assert.strictEqual(body.language, 'ServiceWorker');
    assert.ok(body.project);
    assert.strictEqual(body.project.name, 'infrared');
    assert.ok(body.project.repository);
    assert.ok(body.project.version);
  });

  it('should include CORS headers', async () => {
    const req = new Request('http://localhost/');
    
    const response = await instanceInfo(req, {} as Env);
    
    assert.strictEqual(response.headers.get('access-control-allow-origin'), '*');
    assert.strictEqual(response.headers.get('access-control-allow-headers'), '*');
  });
});
