// app/storage.ts: presigned URLs (deterministic snapshot + independent SigV4 check), config gating, and
// HEAD / DeleteObjects / ListObjectsV2 against an in-memory S3 behind a fetch stub (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const storage = await import('../app/storage.ts');

const config = { endpoint: 'https://t3.storageapi.dev', region: 'auto', bucket: 'honto-photos-kwrqb3lgl-pn', accessKeyId: 'tid_TESTACCESSKEY', secretAccessKey: 'tsec_TestSecretKeyNotReal0000000000000000' };
const now = new Date('2026-10-19T12:00:00Z');
const host = 'honto-photos-kwrqb3lgl-pn.t3.storageapi.dev';

// Independent SigV4 query-signature check (node:crypto only), so the snapshot is not just "whatever aws4fetch did".
function verifyPresigned(rawUrl, method, headers, secret) {
  const url = new URL(rawUrl);
  const rfc3986 = (v) => encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const params = [...url.searchParams].filter(([k]) => k !== 'X-Amz-Signature').map(([k, v]) => [rfc3986(k), rfc3986(v)]).sort(([a], [b]) => (a < b ? -1 : 1));
  const signed = url.searchParams.get('X-Amz-SignedHeaders').split(';');
  const all = { host: url.host, ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])) };
  const canonical = [method, url.pathname, params.map((p) => p.join('=')).join('&'), signed.map((h) => `${h}:${all[h]}\n`).join(''), signed.join(';'), 'UNSIGNED-PAYLOAD'].join('\n');
  const date = url.searchParams.get('X-Amz-Date');
  const scope = url.searchParams.get('X-Amz-Credential').split('/').slice(1).join('/');
  const toSign = ['AWS4-HMAC-SHA256', date, scope, createHash('sha256').update(canonical).digest('hex')].join('\n');
  const [day, region, service] = scope.split('/');
  let key = `AWS4${secret}`;
  for (const part of [day, region, service, 'aws4_request']) key = createHmac('sha256', key).update(part).digest();
  return createHmac('sha256', key).update(toSign).digest('hex') === url.searchParams.get('X-Amz-Signature');
}

test('presignPut / presignGet: virtual-host URLs on the configured endpoint (deterministic snapshot)', async () => {
  const put = await storage.presignPut('couples/cpl_01/photos/ph_ana_1019b/full.jpg', { contentType: 'image/jpeg', bytes: 204800 }, { config, now });
  assert.deepEqual(put, {
    method: 'PUT',
    url: `https://${host}/couples/cpl_01/photos/ph_ana_1019b/full.jpg?X-Amz-Expires=600&X-Amz-Date=20261019T120000Z&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=tid_TESTACCESSKEY%2F20261019%2Fauto%2Fs3%2Faws4_request&X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost&X-Amz-Signature=0a74bc7d95b6ff1675387106bd0567cc1380d6ebb9e2b43c8ed6612cdf398e28`,
    headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '204800' },
    expiresAt: '2026-10-19T12:10:00Z',
  });
  assert.ok(verifyPresigned(put.url, 'PUT', put.headers, config.secretAccessKey), 'PUT signature is valid SigV4 over content-length, content-type and host');
  assert.ok(!verifyPresigned(put.url, 'PUT', { ...put.headers, 'Content-Length': '999999' }, config.secretAccessKey), 'a different Content-Length breaks the signature');

  const get = await storage.presignGet('couples/cpl_01/photos/ph_ana_1019b/thumb.jpg', { config, now });
  assert.deepEqual(get, {
    url: `https://${host}/couples/cpl_01/photos/ph_ana_1019b/thumb.jpg?X-Amz-Expires=86400&X-Amz-Date=20261019T120000Z&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=tid_TESTACCESSKEY%2F20261019%2Fauto%2Fs3%2Faws4_request&X-Amz-SignedHeaders=host&X-Amz-Signature=708937bcac2379837debb70bbbf6f3cbfc0dc85912fd465dedabd99201588b93`,
    expiresAt: '2026-10-20T12:00:00Z',
  });
  assert.ok(verifyPresigned(get.url, 'GET', {}, config.secretAccessKey));

  // The host comes from S3_ENDPOINT (never hardcoded) and keys are percent-encoded per segment.
  const other = await storage.presignGet('a b/c.jpg', { config: { ...config, endpoint: 'https://objects.example.test:9443' }, now, expiresIn: 60 });
  assert.match(other.url, /^https:\/\/honto-photos-kwrqb3lgl-pn\.objects\.example\.test:9443\/a%20b\/c\.jpg\?X-Amz-Expires=60&/);
  assert.equal(other.expiresAt, '2026-10-19T12:01:00Z');
});

test('presign matches the AWS SigV4 documentation example', async () => {
  // docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html (examplebucket, test.txt, 86400 s).
  const aws = { endpoint: 'https://s3.amazonaws.com', region: 'us-east-1', bucket: 'examplebucket', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
  const { url } = await storage.presignGet('test.txt', { config: aws, now: new Date('2013-05-24T00:00:00Z') });
  assert.equal(new URL(url).searchParams.get('X-Amz-Signature'), 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
});

test('storageConfig: null until the bucket keys exist; helpers throw StorageNotConfiguredError', async () => {
  const env = { S3_ENDPOINT: 'https://t3.storageapi.dev', S3_REGION: 'auto', S3_BUCKET: 'honto-photos-kwrqb3lgl-pn', S3_ACCESS_KEY_ID: '', S3_SECRET_ACCESS_KEY: '' };
  assert.equal(storage.storageConfig(env), null);
  assert.equal(storage.storageConfig({ ...env, S3_ACCESS_KEY_ID: 'k' }), null);
  assert.equal(storage.storageConfig({ ...env, S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's', S3_ENDPOINT: 'not a url' }), null);
  assert.deepEqual(storage.storageConfig({ ...env, S3_ACCESS_KEY_ID: ' k ', S3_SECRET_ACCESS_KEY: 's', S3_REGION: '' }), { endpoint: 'https://t3.storageapi.dev', region: 'auto', bucket: 'honto-photos-kwrqb3lgl-pn', accessKeyId: 'k', secretAccessKey: 's' });
  for (const call of [() => storage.getObject('k', { config: null }), () => storage.putObject('k', new Uint8Array(1), 'application/zip', { config: null }), () => storage.presignGet('k', { config: null }), () => storage.presignPut('k', { contentType: 'image/jpeg', bytes: 1 }, { config: null }), () => storage.headObject('k', { config: null }), () => storage.deleteObjects(['k'], { config: null }), () => storage.listPrefix('k', { config: null })]) {
    await assert.rejects(call, storage.StorageNotConfiguredError);
  }
});

test('headObject, deleteObjects and listPrefix against an in-memory S3', async () => {
  const objects = new Map([
    ['couples/c1/photos/p1/full.jpg', { size: 204800, type: 'image/jpeg' }],
    ['couples/c1/photos/p1/thumb.jpg', { size: 19456, type: 'image/jpeg' }],
    ['couples/c1/photos/p2/full.webp', { size: 10, type: 'image/webp' }],
    ['couples/c2/photos/p9/full.jpg', { size: 5, type: 'image/jpeg' }],
    ['exports/u1/x & y.zip', { size: 7, type: 'application/zip' }],
  ]);
  const calls = [];
  let multiDelete = true;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const url = new URL(request.url);
    assert.equal(url.host, host, 'virtual-host requests only');
    assert.match(request.headers.get('authorization') ?? '', /^AWS4-HMAC-SHA256 Credential=tid_TESTACCESSKEY\/\d{8}\/auto\/s3\/aws4_request/);
    calls.push(`${request.method} ${url.pathname}${url.search}`);
    const key = decodeURIComponent(url.pathname.slice(1));
    if (request.method === 'HEAD') {
      const found = objects.get(key);
      return found ? new Response(null, { headers: { 'content-length': String(found.size), 'content-type': found.type, etag: '"e"' } }) : new Response(null, { status: 404 });
    }
    if (request.method === 'POST' && url.searchParams.has('delete')) {
      if (!multiDelete) return new Response('<Error><Code>NotImplemented</Code></Error>', { status: 501 });
      const body = await request.text();
      assert.equal(request.headers.get('content-md5'), createHash('md5').update(body).digest('base64'));
      const keys = [...body.matchAll(/<Key>(.*?)<\/Key>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
      const errors = keys.filter((k) => k.includes('locked'));
      for (const k of keys) if (!errors.includes(k)) objects.delete(k);
      return new Response(`<DeleteResult>${errors.map((k) => `<Error><Key>${k}</Key><Code>AccessDenied</Code></Error>`).join('')}</DeleteResult>`);
    }
    if (request.method === 'DELETE') { objects.delete(key); return new Response(null, { status: 204 }); }
    if (request.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const all = [...objects.keys()].filter((k) => k.startsWith(url.searchParams.get('prefix'))).sort();
      const start = Number(url.searchParams.get('continuation-token') ?? 0);
      const page = all.slice(start, start + 2);
      const more = start + 2 < all.length;
      const esc = (s) => s.replace(/&/g, '&amp;');
      return new Response(`<ListBucketResult><IsTruncated>${more}</IsTruncated>${page.map((k) => `<Contents><Key>${esc(k)}</Key><LastModified>2026-10-19T12:00:00.000Z</LastModified><Size>${objects.get(k).size}</Size></Contents>`).join('')}${more ? `<NextContinuationToken>${start + 2}</NextContinuationToken>` : ''}</ListBucketResult>`);
    }
    if (request.method === 'GET') {
      const found = objects.get(key);
      return found ? new Response(found.data ?? new Uint8Array(found.size), { headers: { 'content-type': found.type } }) : new Response(null, { status: 404 });
    }
    if (request.method === 'PUT') {
      const data = new Uint8Array(await request.arrayBuffer());
      objects.set(key, { size: data.length, type: request.headers.get('content-type'), data });
      return new Response(null, { status: 200 });
    }
    return new Response(null, { status: 400 });
  };
  try {
    assert.deepEqual(await storage.headObject('couples/c1/photos/p1/full.jpg', { config }), { size: 204800, contentType: 'image/jpeg', etag: '"e"' });
    assert.equal(await storage.headObject('couples/c1/photos/nope/full.jpg', { config }), null);

    const listed = await storage.listPrefix('couples/c1/', { config });
    assert.deepEqual(listed.map((o) => [o.key, o.size]), [['couples/c1/photos/p1/full.jpg', 204800], ['couples/c1/photos/p1/thumb.jpg', 19456], ['couples/c1/photos/p2/full.webp', 10]]);
    assert.equal(listed[0].lastModified, '2026-10-19T12:00:00.000Z');
    assert.equal(calls.filter((c) => c.startsWith('GET')).length, 2, 'followed the continuation token');
    assert.deepEqual((await storage.listPrefix('exports/', { config })).map((o) => o.key), ['exports/u1/x & y.zip']);
    assert.equal((await storage.listPrefix('couples/', { config, limit: 1 })).length, 1);

    objects.set('couples/c2/locked.jpg', { size: 1, type: 'image/jpeg' });
    const result = await storage.deleteObjects(['couples/c1/photos/p1/full.jpg', 'couples/c1/photos/p1/thumb.jpg', 'couples/c1/photos/p1/full.jpg', 'exports/u1/x & y.zip', 'couples/c2/locked.jpg', ''], { config });
    assert.deepEqual(result, { deleted: 3, errors: [{ key: 'couples/c2/locked.jpg', code: 'AccessDenied' }] });
    assert.deepEqual([...objects.keys()].sort(), ['couples/c1/photos/p2/full.webp', 'couples/c2/locked.jpg', 'couples/c2/photos/p9/full.jpg']);

    await storage.putObject('exports/u1/e1.zip', new Uint8Array([0x50, 0x4b, 3, 4]), 'application/zip', { config });
    assert.deepEqual(objects.get('exports/u1/e1.zip'), { size: 4, type: 'application/zip', data: new Uint8Array([0x50, 0x4b, 3, 4]) });
    assert.deepEqual([...(await storage.getObject('exports/u1/e1.zip', { config }))], [0x50, 0x4b, 3, 4]);
    assert.equal(await storage.getObject('exports/u1/nope.zip', { config }), null);
    assert.ok(calls.includes('PUT /exports/u1/e1.zip') && calls.includes('GET /exports/u1/e1.zip'), 'signed server-side GET / PUT');
    objects.delete('exports/u1/e1.zip');

    multiDelete = false;
    assert.deepEqual(await storage.deleteObjects(['couples/c1/photos/p2/full.webp'], { config }), { deleted: 1, errors: [] });
    assert.ok(calls.includes('DELETE /couples/c1/photos/p2/full.webp'), 'falls back to single DELETE without DeleteObjects');
    assert.deepEqual(await storage.deleteObjects([], { config }), { deleted: 0, errors: [] });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('no R2 variables or Cloudflare R2 hosts anywhere in the repo', () => {
  // Built from parts so this file does not match itself.
  const patterns = [new RegExp(['\\bR2', '_[A-Z]'].join('')), new RegExp(['cloudflare', 'storage'].join(''), 'i')];
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }).split('\n')
    .filter((file) => file && /\.(?:[cm]?[jt]sx?|json|ya?ml|md|sql|toml|sh|dart|swift|kt|env|example|txt)$/.test(file));
  assert.ok(files.length > 100);
  const offenders = [];
  for (const file of files) {
    let content;
    try { content = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'); } catch { continue; }
    if (patterns.some((p) => p.test(content))) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});
