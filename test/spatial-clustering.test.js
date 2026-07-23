const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCoordinateBuckets,
  buildSpatialGridKey,
  clusterRowsByGrid,
  selectRepresentativeCoordinate,
  partitionRowsByRules,
} = require('../lib/spatial-clustering');
const { findMatchingRule } = require('../lib/override-rules');

function row(assetId, latitude, longitude) {
  return { assetId, latitude, longitude };
}

test('identical coordinates are collapsed into one coordinate bucket', () => {
  const buckets = buildCoordinateBuckets([
    row('a', 37.5, 126.9),
    row('b', 37.5, 126.9),
    row('c', 37.5001, 126.9),
  ]);

  assert.equal(buckets.length, 2);
  assert.deepEqual(buckets[0].assetIds, ['a', 'b']);
});

test('grid clustering is deterministic regardless of input order', () => {
  const rows = [
    row('a', 37.5, 126.9),
    row('b', 37.50001, 126.90001),
    row('c', 37.6, 127.0),
  ];

  const summarize = (items) => clusterRowsByGrid(items, 15).map((cluster) => ({
    key: cluster.clusterKey,
    assetIds: [...cluster.assetIds].sort(),
    representative: [cluster.centroidLat, cluster.centroidLon],
  }));

  assert.deepEqual(summarize(rows), summarize([...rows].reverse()));
});

test('single-coordinate grid key matches the cluster cache key', () => {
  const source = row('a', 37.5, 126.9);
  const grid = buildSpatialGridKey(source.latitude, source.longitude, 15);
  const cluster = clusterRowsByGrid([source], 15)[0];
  assert.equal(grid.key, cluster.geoCacheKey);
});

test('representative coordinate is always one of the actual coordinates', () => {
  const rows = [
    row('a', 37.5, 126.9),
    row('b', 37.50002, 126.90002),
    row('c', 37.50004, 126.90004),
  ];
  const representative = selectRepresentativeCoordinate(rows);

  assert.ok(rows.some((item) =>
    item.latitude === representative.latitude && item.longitude === representative.longitude));
});

test('polygon override partitions assets by each actual coordinate', () => {
  const rule = {
    id: 'inside',
    enabled: true,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [126.9, 37.5],
        [126.91, 37.5],
        [126.91, 37.51],
        [126.9, 37.51],
      ],
    },
  };
  const inside = row('inside-asset', 37.505, 126.905);
  const outside = row('outside-asset', 37.505, 126.915);
  const result = partitionRowsByRules([inside, outside], [rule], findMatchingRule);

  assert.deepEqual(result.matches[0].rows.map((item) => item.assetId), ['inside-asset']);
  assert.deepEqual(result.remainingRows.map((item) => item.assetId), ['outside-asset']);
});
