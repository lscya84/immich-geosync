const EARTH_RADIUS_METERS = 6378137;
const KOREA_REFERENCE_LATITUDE_RADIANS = 36 * Math.PI / 180;

function toLocalMeters(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  const x = EARTH_RADIUS_METERS * lon * Math.PI / 180 * Math.cos(KOREA_REFERENCE_LATITUDE_RADIANS);
  const y = EARTH_RADIUS_METERS * lat * Math.PI / 180;
  return { x, y };
}

function coordinateKey(row) {
  return `${Number(row.latitude)}:${Number(row.longitude)}`;
}

function buildSpatialGridKey(latitude, longitude, cellSizeMeters = 15) {
  const size = Math.max(1, Number(cellSizeMeters) || 15);
  const projected = toLocalMeters(latitude, longitude);
  const cellX = Math.floor(projected.x / size);
  const cellY = Math.floor(projected.y / size);
  return { key: `grid:${size}:${cellX}:${cellY}`, cellX, cellY, projected, size };
}

function buildCoordinateBuckets(rows) {
  const buckets = new Map();

  for (const row of rows) {
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

    const key = coordinateKey({ latitude, longitude });
    if (!buckets.has(key)) {
      buckets.set(key, { key, latitude, longitude, rows: [], assetIds: [] });
    }
    const bucket = buckets.get(key);
    bucket.rows.push(row);
    bucket.assetIds.push(row.assetId);
  }

  return [...buckets.values()].sort((a, b) =>
    (a.latitude - b.latitude) || (a.longitude - b.longitude) || a.key.localeCompare(b.key));
}

function clusterRowsByGrid(rows, cellSizeMeters = 15) {
  const size = Math.max(1, Number(cellSizeMeters) || 15);
  const clusters = new Map();

  for (const bucket of buildCoordinateBuckets(rows)) {
    const { key, cellX, cellY, projected } = buildSpatialGridKey(bucket.latitude, bucket.longitude, size);

    if (!clusters.has(key)) {
      clusters.set(key, {
        clusterId: key,
        clusterKey: key,
        geoCacheKey: key,
        cellX,
        cellY,
        coordinateBuckets: [],
        assetIds: [],
        points: [],
      });
    }

    const cluster = clusters.get(key);
    cluster.coordinateBuckets.push({ ...bucket, projected });
    for (const assetId of bucket.assetIds) cluster.assetIds.push(assetId);
    for (const row of bucket.rows) cluster.points.push(row);
  }

  return [...clusters.values()]
    .sort((a, b) => a.clusterKey.localeCompare(b.clusterKey))
    .map((cluster) => {
      const centerX = (cluster.cellX + 0.5) * size;
      const centerY = (cluster.cellY + 0.5) * size;
      const representative = [...cluster.coordinateBuckets].sort((a, b) => {
        const aDistance = (a.projected.x - centerX) ** 2 + (a.projected.y - centerY) ** 2;
        const bDistance = (b.projected.x - centerX) ** 2 + (b.projected.y - centerY) ** 2;
        return (aDistance - bDistance) || a.key.localeCompare(b.key);
      })[0];

      return {
        clusterId: cluster.clusterId,
        clusterKey: cluster.clusterKey,
        geoCacheKey: cluster.geoCacheKey,
        centroidLat: representative.latitude,
        centroidLon: representative.longitude,
        assetCount: cluster.assetIds.length,
        uniqueCoordinateCount: cluster.coordinateBuckets.length,
        assetIds: cluster.assetIds,
        points: cluster.points,
      };
    });
}

function selectRepresentativeCoordinate(rows) {
  const buckets = buildCoordinateBuckets(rows);
  if (!buckets.length) return null;

  const assetCount = buckets.reduce((sum, bucket) => sum + bucket.assetIds.length, 0);
  const meanLatitude = buckets.reduce((sum, bucket) => sum + bucket.latitude * bucket.assetIds.length, 0) / assetCount;
  const meanLongitude = buckets.reduce((sum, bucket) => sum + bucket.longitude * bucket.assetIds.length, 0) / assetCount;
  const mean = toLocalMeters(meanLatitude, meanLongitude);

  return [...buckets].sort((a, b) => {
    const aPoint = toLocalMeters(a.latitude, a.longitude);
    const bPoint = toLocalMeters(b.latitude, b.longitude);
    const aDistance = (aPoint.x - mean.x) ** 2 + (aPoint.y - mean.y) ** 2;
    const bDistance = (bPoint.x - mean.x) ** 2 + (bPoint.y - mean.y) ** 2;
    return (aDistance - bDistance) || a.key.localeCompare(b.key);
  })[0];
}

function partitionRowsByRules(rows, rules, findMatchingRule) {
  const grouped = new Map();
  const remainingRows = [];

  for (const row of rows) {
    const rule = findMatchingRule(Number(row.latitude), Number(row.longitude), rules);
    if (!rule) {
      remainingRows.push(row);
      continue;
    }
    if (!grouped.has(rule.id)) grouped.set(rule.id, { rule, rows: [] });
    grouped.get(rule.id).rows.push(row);
  }

  return { matches: [...grouped.values()], remainingRows };
}

module.exports = {
  buildCoordinateBuckets,
  buildSpatialGridKey,
  clusterRowsByGrid,
  selectRepresentativeCoordinate,
  partitionRowsByRules,
};
