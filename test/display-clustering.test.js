const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDisplayClusters,
  getBaseGridSize,
} = require('../admin/display-clustering');

function makeCluster(index, overrides = {}) {
  return {
    clusterKey: `cluster-${index}`,
    latitude: 37.5 + ((index % 30) * 0.00005),
    longitude: 127 + (Math.floor(index / 30) * 0.00005),
    assetCount: 1,
    ...overrides,
  };
}

test('고배율에서도 일반 위치점은 최대 300개로 집계한다', () => {
  const clusters = Array.from({ length: 900 }, (_, index) => makeCluster(index));
  const result = buildDisplayClusters(clusters, 18);
  assert.ok(result.length <= 300);
  assert.equal(result.reduce((sum, cluster) => sum + cluster.assetCount, 0), 900);
});

test('수동 그룹과 단일 규칙은 일반 위치점 집계와 분리한다', () => {
  const clusters = [
    ...Array.from({ length: 900 }, (_, index) => makeCluster(index)),
    makeCluster(901, { clusterType: 'manual_group', groupId: 'group-1' }),
    makeCluster(902, { clusterType: 'single_rule', ruleId: 'rule-1' }),
  ];
  const result = buildDisplayClusters(clusters, 18);
  assert.ok(result.some((cluster) => cluster.groupId === 'group-1'));
  assert.ok(result.some((cluster) => cluster.ruleId === 'rule-1'));
  assert.ok(result.filter((cluster) => !cluster.groupId && !cluster.ruleId).length <= 300);
});

test('줌이 높아질수록 기본 격자가 작아진다', () => {
  assert.ok(getBaseGridSize(18) < getBaseGridSize(16));
  assert.ok(getBaseGridSize(16) < getBaseGridSize(14));
});
