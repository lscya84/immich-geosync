(function exposeDisplayClustering(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeoSyncDisplayClustering = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const DEFAULT_MAX_REGULAR_MARKERS = 300;

  function getBaseGridSize(zoom) {
    if (zoom <= 7) return 0.8;
    if (zoom <= 9) return 0.25;
    if (zoom <= 11) return 0.08;
    if (zoom <= 13) return 0.03;
    if (zoom === 14) return 0.01;
    if (zoom === 15) return 0.004;
    if (zoom === 16) return 0.0015;
    if (zoom === 17) return 0.0006;
    return 0.00025;
  }

  function groupRegularClusters(clusters, zoom, gridSize) {
    const grouped = new Map();
    clusters.forEach((cluster) => {
      const latitude = Number(cluster.latitude);
      const longitude = Number(cluster.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

      const latKey = Math.floor(latitude / gridSize);
      const lngKey = Math.floor(longitude / gridSize);
      const key = `${zoom}:${gridSize}:${latKey}:${lngKey}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          bucketKey: key,
          latitudeSum: 0,
          longitudeSum: 0,
          assetCount: 0,
          sourceClusters: [],
        });
      }
      const bucket = grouped.get(key);
      const weight = Math.max(1, Number(cluster.assetCount) || 1);
      bucket.latitudeSum += latitude * weight;
      bucket.longitudeSum += longitude * weight;
      bucket.assetCount += weight;
      bucket.sourceClusters.push(cluster);
    });

    return [...grouped.values()].map((bucket) => {
      const primary = bucket.sourceClusters[0];
      const mergedClusterCount = bucket.sourceClusters.length;
      return {
        ...primary,
        clusterKey: bucket.bucketKey,
        latitude: bucket.latitudeSum / bucket.assetCount,
        longitude: bucket.longitudeSum / bucket.assetCount,
        displayGrid: {
          south: Math.floor(Number(primary.latitude) / gridSize) * gridSize,
          north: (Math.floor(Number(primary.latitude) / gridSize) + 1) * gridSize,
          west: Math.floor(Number(primary.longitude) / gridSize) * gridSize,
          east: (Math.floor(Number(primary.longitude) / gridSize) + 1) * gridSize,
        },
        assetCount: bucket.assetCount,
        sourceClusters: bucket.sourceClusters,
        mergedClusterCount,
        isMergedDisplayCluster: mergedClusterCount > 1,
      };
    });
  }

  function buildDisplayClusters(clusters, zoom, maxRegularMarkers = DEFAULT_MAX_REGULAR_MARKERS) {
    const specialClusters = [];
    const regularClusters = [];
    (Array.isArray(clusters) ? clusters : []).forEach((cluster) => {
      if (cluster?.clusterType === 'manual_group' || cluster?.clusterType === 'single_rule' || cluster?.ruleId) {
        specialClusters.push(cluster);
      } else {
        regularClusters.push(cluster);
      }
    });

    let gridSize = getBaseGridSize(zoom);
    let grouped = groupRegularClusters(regularClusters, zoom, gridSize);
    let attempts = 0;
    while (grouped.length > maxRegularMarkers && attempts < 12) {
      gridSize *= 1.6;
      grouped = groupRegularClusters(regularClusters, zoom, gridSize);
      attempts += 1;
    }

    return [...specialClusters, ...grouped];
  }

  return {
    DEFAULT_MAX_REGULAR_MARKERS,
    getBaseGridSize,
    buildDisplayClusters,
  };
}));
