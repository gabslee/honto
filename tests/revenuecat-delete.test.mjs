// deleteRevenueCatCustomer: RevenueCat REST API v2 customer delete after an account deletion. No real network.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as module from 'node:module';

const hooks = module.registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@neondatabase/serverless') return { url: 'data:text/javascript,export const neon=()=>{throw new Error("no db")}', shortCircuit: true };
  if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) return next(new URL(specifier + '.ts', context.parentURL).href, context);
  return next(specifier, context);
} });
test.after(() => hooks.deregister());

const { deleteRevenueCatCustomer } = await import('../server/v1/account-cleanup.ts');
const env = { REVENUECAT_SECRET_API_KEY: 'sk_v2_test', REVENUECAT_PROJECT_ID: 'projtest1' };

async function withFetch(respond, run) {
  const calls = [];
  const realFetch = globalThis.fetch;
  const realWarn = console.warn; const realError = console.error;
  const logs = [];
  globalThis.fetch = async (input, init = {}) => { calls.push({ url: String(input), method: init.method, authorization: init.headers?.authorization }); return respond(); };
  console.warn = (...a) => logs.push(['warn', a.join(' ')]);
  console.error = (...a) => logs.push(['error', a.join(' ')]);
  try { return { result: await run(), calls, logs }; } finally { globalThis.fetch = realFetch; console.warn = realWarn; console.error = realError; }
}

test('deletes the customer via API v2 with the project id and a URL-encoded app user id', async () => {
  const { result, calls, logs } = await withFetch(() => Response.json({ object: 'customer', id: 'usr a/b', deleted_at: 1 }), () => deleteRevenueCatCustomer('usr a/b', env));
  assert.equal(result, 200);
  assert.deepEqual(calls, [{ url: 'https://api.revenuecat.com/v2/projects/projtest1/customers/usr%20a%2Fb', method: 'DELETE', authorization: 'Bearer sk_v2_test' }]);
  assert.deepEqual(logs, []);
});

test('404 counts as success: the customer is already gone', async () => {
  const { result, logs } = await withFetch(() => Response.json({ type: 'resource_missing' }, { status: 404 }), () => deleteRevenueCatCustomer('usr_gone', env));
  assert.equal(result, 404);
  assert.deepEqual(logs, [], 'no error logged');
});

test('other failures are logged without the key and never throw', async () => {
  const failed = await withFetch(() => new Response('nope', { status: 403 }), () => deleteRevenueCatCustomer('usr_x', env));
  assert.equal(failed.result, 403);
  assert.equal(failed.logs.length, 1);
  assert.match(failed.logs[0][1], /RevenueCat customer delete failed \(403\)/);
  const down = await withFetch(() => { throw new Error('network down'); }, () => deleteRevenueCatCustomer('usr_x', env));
  assert.equal(down.result, null);
  for (const [, line] of [...failed.logs, ...down.logs]) assert.doesNotMatch(line, /sk_v2_test/);
});

test('a missing key or project id logs a warning and skips the call', async () => {
  for (const [partial, name] of [[{ REVENUECAT_SECRET_API_KEY: 'sk_v2_test' }, 'REVENUECAT_PROJECT_ID'], [{ REVENUECAT_PROJECT_ID: 'projtest1' }, 'REVENUECAT_SECRET_API_KEY'], [{ REVENUECAT_SECRET_API_KEY: ' ', REVENUECAT_PROJECT_ID: '' }, 'REVENUECAT_SECRET_API_KEY and REVENUECAT_PROJECT_ID']]) {
    const { result, calls, logs } = await withFetch(() => { throw new Error('unexpected network call'); }, () => deleteRevenueCatCustomer('usr_x', partial));
    assert.equal(result, null);
    assert.equal(calls.length, 0);
    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], 'warn');
    assert.ok(logs[0][1].includes(`${name} not set`), logs[0][1]);
    assert.doesNotMatch(logs[0][1], /sk_v2_test/);
  }
});
