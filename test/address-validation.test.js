const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeAdministrativeKey,
  isSouthKoreanAddress,
  isWithinSouthKoreaBoundary,
  compareProviderAddresses,
  getBoundaryValidationPoints,
} = require('../lib/address-validation');

test('accepts only a recognized South Korean state', () => {
  assert.equal(isSouthKoreanAddress({ country: '대한민국', state: '경기도' }), true);
  assert.equal(isSouthKoreanAddress({ country: '대한민국', state: '평양직할시' }), false);
  assert.equal(isSouthKoreanAddress({ country: 'Japan', state: '경기도' }), false);
});

test('country boundary includes mainland and major islands but rejects foreign cities', () => {
  assert.equal(isWithinSouthKoreaBoundary(37.5665, 126.9780), true);
  assert.equal(isWithinSouthKoreaBoundary(33.4996, 126.5312), true);
  assert.equal(isWithinSouthKoreaBoundary(37.484, 130.905), true);
  assert.equal(isWithinSouthKoreaBoundary(35.6762, 139.6503), false);
  assert.equal(isWithinSouthKoreaBoundary(39.0392, 125.7625), false);
});

test('provider comparison ignores a display building suffix', () => {
  const vworld = { state: '경기도', city: '김포시 북변동' };
  const naver = { state: '경기도', city: '김포시 북변동 (김포아파트)' };
  assert.equal(compareProviderAddresses(vworld, naver), true);
  assert.equal(normalizeAdministrativeKey(vworld), '경기도|김포시 북변동');
});

test('returns extreme points only for a spatially spread cluster', () => {
  const cluster = {
    centroidLat: 37.5,
    centroidLon: 126.9,
    points: [
      { latitude: 37.5, longitude: 126.9 },
      { latitude: 37.5002, longitude: 126.9 },
      { latitude: 37.5, longitude: 126.9002 },
    ],
  };
  assert.ok(getBoundaryValidationPoints(cluster, 10).length >= 2);
  assert.equal(getBoundaryValidationPoints(cluster, 100).length, 0);
});
