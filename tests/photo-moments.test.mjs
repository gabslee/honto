import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PHOTO_BYTES, JAPANESE_PHRASES, sniffImageType, validatePhoto, resolvePhrase } from '../app/photo-moments.js';
import { mobileAction } from '../app/api/mobile/mobile-routes.js';

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
const heic = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode('ftypheic')]);

test('image type comes from magic bytes, not the client', () => {
  assert.equal(sniffImageType(jpeg), 'image/jpeg');
  assert.equal(sniffImageType(png), 'image/png');
  assert.equal(sniffImageType(webp), 'image/webp');
  assert.equal(sniffImageType(heic), 'image/heic');
  assert.equal(sniffImageType(new TextEncoder().encode('<svg onload=alert(1)>')), null);
  assert.equal(sniffImageType(new TextEncoder().encode('GIF89a')), null);
});

test('size limit and type check', () => {
  assert.deepEqual(validatePhoto(jpeg, jpeg.length), { type: 'image/jpeg', ext: 'jpg' });
  assert.throws(() => validatePhoto(jpeg, MAX_PHOTO_BYTES + 1), /5 MB/);
  assert.throws(() => validatePhoto(new Uint8Array([1, 2, 3]), 3), /Only JPEG/);
  assert.throws(() => validatePhoto(new Uint8Array(), 0), /Choose a photo/);
});

test('Japanese-themed phrases', () => {
  assert.ok(JAPANESE_PHRASES.length >= 8);
  for (const p of JAPANESE_PHRASES) { assert.match(p.ja, /[\u3040-\u30ff\u4e00-\u9faf]/); assert.ok(p.romaji && p.en && p.pt); }
  assert.deepEqual(resolvePhrase('aitai'), { key: 'aitai', text: '会いたい' });
  assert.deepEqual(resolvePhrase('nope', '  いつも  ありがとう '), { key: null, text: 'いつも ありがとう' });
  assert.equal(resolvePhrase(null, 'x'.repeat(200)).text.length, 80);
  assert.throws(() => resolvePhrase(null, ' '), /phrase/);
});

test('photo routes', () => {
  assert.equal(mobileAction('POST', ['moments', 'photo']), 'photoUpload');
  assert.equal(mobileAction('GET', ['moments', 'latest']), 'photoLatest');
});
