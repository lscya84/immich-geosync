const path = require('path');
const express = require('express');
const { reverseGeocode } = require('./lib/geocode');
const { getPolygonCentroid } = require('./lib/cluster-rule-address');
const { listSettings, updateSettings } = require('./lib/env-settings');
const {
  ensureAdminTables,
  listRules,
  listRuleAssetCounts,
  createRule,
  updateRule,
  deleteRule,
  previewRule,
  applyRule,
  listGroups,
  createGroup,
  deleteGroup,
  previewGroup,
  listClusters,
  getRuleClusterAssets,
  getClusterAssets,
  getMergedClusterAssets,
  updateClusterAddress,
  updateClusterCoordinates,
  mergeCoordinateClusters,
  listClusterGeocodeCaches,
  updateClusterGeocodeCache,
  getWorkerStatus,
  getAssetPreviewPath,
  getAssetThumbnailPath,
} = require('./lib/admin-db');

const app = express();
const port = parseInt(process.env.ADMIN_PORT || '3030', 10);
const uploadRoot = (process.env.UPLOAD_LOCATION || '/usr/src/app/upload').trim() || '/usr/src/app/upload';
const mapStyleLightTileUrl = (process.env.IMMICH_MAP_STYLE_LIGHT_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png').trim();
const mapStyleDarkTileUrl = (process.env.IMMICH_MAP_STYLE_DARK_TILE_URL || mapStyleLightTileUrl).trim();
const mapStyleLightAttribution = (process.env.IMMICH_MAP_STYLE_LIGHT_ATTRIBUTION || '© OpenStreetMap contributors').trim();
const mapStyleDarkAttribution = (process.env.IMMICH_MAP_STYLE_DARK_ATTRIBUTION || mapStyleLightAttribution).trim();
const mapStyleMaxZoom = Math.max(0, Math.min(22, parseInt(process.env.IMMICH_MAP_STYLE_MAX_ZOOM || '19', 10) || 19));
const adminDebugLogs = /^(1|true|yes|on)$/i.test(String(process.env.ADMIN_DEBUG_LOGS || '').trim());
const appendBuildingName = String(process.env.APPEND_BUILDING_NAME || 'true').toLowerCase() === 'true';

function adminDebug(event, payload = {}) {
  if (!adminDebugLogs) return;
  console.log(`[admin-debug] ${JSON.stringify({ scope: 'admin-server', event, ...payload })}`);
}

app.use(express.json({ limit: '1mb' }));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

function buildRasterMapStyle({ name, tileUrl, attribution }) {
  return {
    version: 8,
    name,
    sources: {
      basemap: {
        type: 'raster',
        tiles: [tileUrl],
        tileSize: 256,
        attribution,
        maxzoom: mapStyleMaxZoom,
      },
    },
    layers: [
      {
        id: 'basemap',
        type: 'raster',
        source: 'basemap',
      },
    ],
  };
}

function validateRulePayload(body) {
  if (!body || typeof body !== 'object') return '요청 본문이 필요합니다.';
  if (!body.name || typeof body.name !== 'string') return 'name은 필수입니다.';
  if (!['point', 'polygon'].includes(body.ruleType)) return 'ruleType은 point 또는 polygon이어야 합니다.';
  if (!body.geometry || typeof body.geometry !== 'object') return 'geometry는 필수입니다.';
  if (body.applyAsOverride === false && body.treatAsSingleCluster !== true) {
    return 'override 또는 single cluster 중 하나는 활성화되어야 합니다.';
  }
  return null;
}

function validateGroupPayload(body) {
  if (!body || typeof body !== 'object') return '요청 본문이 필요합니다.';
  if (!body.name || typeof body.name !== 'string') return 'name은 필수입니다.';
  if (!body.geometry || typeof body.geometry !== 'object') return 'geometry는 필수입니다.';
  if (body.geometry.type !== 'Polygon') return 'group geometry는 polygon만 지원합니다.';
  return null;
}

app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/runtime-config', (req, res) => {
  res.json({
    naverMapsClientId: (process.env.NAVER_MAPS_CLIENT_ID || process.env.NAVER_CLIENT_ID || '').trim(),
  });
});

app.get('/api/admin/worker', async (req, res) => {
  try {
    res.json(await getWorkerStatus({ logLimit: req.query.logLimit }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/settings', (req, res) => {
  try {
    res.json(listSettings());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/admin/settings', (req, res) => {
  try {
    res.json(updateSettings(req.body?.settings || {}));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/map-styles/light.json', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cache-Control', 'public, max-age=300');
  res.json(buildRasterMapStyle({
    name: 'Immich GeoSync Admin Light',
    tileUrl: mapStyleLightTileUrl,
    attribution: mapStyleLightAttribution,
  }));
});

app.get('/map-styles/dark.json', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cache-Control', 'public, max-age=300');
  res.json(buildRasterMapStyle({
    name: 'Immich GeoSync Admin Dark',
    tileUrl: mapStyleDarkTileUrl,
    attribution: mapStyleDarkAttribution,
  }));
});

app.post('/api/reverse-geocode/centroid', async (req, res) => {
  const geometry = req.body?.geometry;
  if (!geometry || geometry.type !== 'Polygon') {
    return res.status(400).json({ error: 'polygon geometry가 필요합니다.' });
  }

  const centroid = getPolygonCentroid(geometry);
  if (!centroid) {
    return res.status(400).json({ error: 'polygon 중심점을 계산할 수 없습니다.' });
  }

  try {
    const result = await reverseGeocode(centroid.lat, centroid.lon, {
      naverId: (process.env.NAVER_CLIENT_ID || '').trim(),
      naverSecret: (process.env.NAVER_CLIENT_SECRET || '').trim(),
      vworldKey: (process.env.VWORLD_API_KEY || '').trim(),
      apiTimeoutMs: parseInt(process.env.NAVER_API_TIMEOUT_MS || process.env.API_TIMEOUT_MS || '10000', 10),
    }, {
      preferBuildingName: appendBuildingName,
    });

    if (!result.ok) {
      return res.status(502).json({
        error: `중심점 주소 조회 실패: ${result.error || 'unknown'}`,
        centroid,
      });
    }

    return res.json({
      centroid,
      address: {
        country: result.summary.country || '대한민국',
        state: result.summary.state || '',
        city: result.summary.city || '',
        buildingName: result.summary.buildingName || '',
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message, centroid });
  }
});

app.get('/api/rules', async (req, res) => {
  try {
    res.json({ rules: await listRules() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/rules/counts', async (req, res) => {
  try {
    res.json({ counts: await listRuleAssetCounts() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/rules', async (req, res) => {
  const errorMessage = validateRulePayload(req.body);
  if (errorMessage) return res.status(400).json({ error: errorMessage });

  try {
    const rule = await createRule(req.body);
    res.status(201).json({ rule });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/rules/:id', async (req, res) => {
  const errorMessage = validateRulePayload(req.body);
  if (errorMessage) return res.status(400).json({ error: errorMessage });

  try {
    const rule = await updateRule(req.params.id, req.body);
    if (!rule) return res.status(404).json({ error: 'rule을 찾을 수 없습니다.' });
    res.json({ rule });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/rules/:id', async (req, res) => {
  try {
    const deleted = await deleteRule(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'rule을 찾을 수 없습니다.' });
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/rules/:id/preview', async (req, res) => {
  try {
    const result = await previewRule(req.params.id);
    if (!result) return res.status(404).json({ error: 'rule을 찾을 수 없습니다.' });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/rules/:id/apply', async (req, res) => {
  try {
    const result = await applyRule(req.params.id);
    if (!result) return res.status(404).json({ error: 'rule을 찾을 수 없습니다.' });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/groups', async (req, res) => {
  try {
    res.json({ groups: await listGroups() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/groups', async (req, res) => {
  const errorMessage = validateGroupPayload(req.body);
  if (errorMessage) return res.status(400).json({ error: errorMessage });

  try {
    const group = await createGroup(req.body);
    res.status(201).json({ group });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/groups/:id', async (req, res) => {
  try {
    const deleted = await deleteGroup(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'group을 찾을 수 없습니다.' });
    res.status(204).end();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/groups/:id/preview', async (req, res) => {
  try {
    const result = await previewGroup(req.params.id);
    if (!result) return res.status(404).json({ error: 'group을 찾을 수 없습니다.' });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/clusters', async (req, res) => {
  try {
    const bounds = {
      south: Number(req.query.south),
      north: Number(req.query.north),
      west: Number(req.query.west),
      east: Number(req.query.east),
      zoom: Number(req.query.zoom),
    };
    const clusters = await listClusters(bounds);
    adminDebug('api.clusters', {
      bounds,
      returnedClusters: clusters.length,
      topClusterAssetCount: clusters[0]?.assetCount || 0,
    });
    res.json({ clusters });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function withAssetUrls(assets = []) {
  return assets.map((asset) => ({
    ...asset,
    previewUrl: asset.previewPath ? `/api/assets/${asset.assetId}/preview` : '',
    thumbnailUrl: asset.thumbnailPath ? `/api/assets/${asset.assetId}/thumbnail` : '',
  }));
}

function paginateAssets(assets = [], limit = 12) {
  const pageLimit = Math.max(1, Math.min(30, Number(limit) || 12));
  return {
    assets: withAssetUrls(assets.slice(0, pageLimit)),
    hasMore: assets.length > pageLimit,
  };
}

app.get('/api/clusters/assets', async (req, res) => {
  const ruleId = String(req.query.ruleId || '').trim();
  const latitude = Number(req.query.latitude);
  const longitude = Number(req.query.longitude);
  const limit = Number(req.query.limit || 12);
  const precision = Number(req.query.precision || 5);
  const offset = Number(req.query.offset || 0);

  if (!ruleId && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
    return res.status(400).json({ error: 'latitude, longitude가 필요합니다.' });
  }

  try {
    const pageLimit = Math.max(1, Math.min(30, Number(limit) || 12));
    const assets = ruleId
      ? await getRuleClusterAssets(ruleId, pageLimit + 1, offset)
      : await getClusterAssets(latitude, longitude, pageLimit + 1, precision, offset);
    const page = paginateAssets(assets, pageLimit);
    adminDebug('api.clusterAssets', {
      ruleId,
      latitude,
      longitude,
      precision,
      limit: pageLimit,
      offset,
      returnedCount: page.assets.length,
      hasMore: page.hasMore,
    });
    res.json(page);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/clusters/assets/merge', async (req, res) => {
  const sources = Array.isArray(req.body?.sources) ? req.body.sources : [];
  const limit = Number(req.body?.limit || 12);
  const offset = Number(req.body?.offset || 0);

  if (!sources.length) {
    return res.status(400).json({ error: 'sources가 필요합니다.' });
  }

  try {
    const pageLimit = Math.max(1, Math.min(30, Number(limit) || 12));
    const assets = await getMergedClusterAssets(sources, pageLimit + 1, offset);
    const page = paginateAssets(assets, pageLimit);
    adminDebug('api.mergedClusterAssets', {
      sourceCount: sources.length,
      sourcePreview: sources.slice(0, 8),
      limit: pageLimit,
      offset,
      returnedCount: page.assets.length,
      hasMore: page.hasMore,
    });
    res.json(page);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/clusters/merge', async (req, res) => {
  const sources = Array.isArray(req.body?.sources) ? req.body.sources : [];
  const name = String(req.body?.name || '').trim();

  if (sources.length < 2) {
    return res.status(400).json({ error: '최소 2개 클러스터를 선택해야 합니다.' });
  }

  try {
    const result = await mergeCoordinateClusters({ name, sources });
    adminDebug('api.mergeClusters', {
      sourceCount: sources.length,
      cacheAction: result.cacheAction,
      deletedCacheCount: result.deletedCacheCount,
      groupId: result.group?.id || null,
    });
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/clusters/location', async (req, res) => {
  if (req.body?.isMergedDisplayCluster) {
    return res.status(400).json({ error: '합쳐진 표시 클러스터는 바로 수정할 수 없습니다.' });
  }
  if (Number(req.body?.mergedClusterCount || 1) > 1) {
    return res.status(400).json({ error: '최소단위 클러스터에서만 수정할 수 있습니다.' });
  }

  try {
    const result = await updateClusterAddress({
      ruleId: req.body?.ruleId || '',
      latitude: req.body?.latitude,
      longitude: req.body?.longitude,
      precision: req.body?.precision,
      state: req.body?.state,
      city: req.body?.city,
    });
    if (!result) return res.status(404).json({ error: '클러스터 대상을 찾을 수 없습니다.' });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/clusters/coordinates', async (req, res) => {
  if (req.body?.isMergedDisplayCluster) {
    return res.status(400).json({ error: '합쳐진 표시 클러스터는 바로 수정할 수 없습니다.' });
  }
  if (Number(req.body?.mergedClusterCount || 1) > 1) {
    return res.status(400).json({ error: '최소단위 클러스터에서만 수정할 수 있습니다.' });
  }
  if (req.body?.ruleId) {
    return res.status(400).json({ error: 'single cluster rule 중심점은 여기서 직접 바꿀 수 없습니다.' });
  }

  try {
    const result = await updateClusterCoordinates({
      latitude: req.body?.latitude,
      longitude: req.body?.longitude,
      precision: req.body?.precision,
      nextLatitude: req.body?.nextLatitude,
      nextLongitude: req.body?.nextLongitude,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/clusters/cache', async (req, res) => {
  try {
    res.json({ caches: await listClusterGeocodeCaches() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/clusters/cache/:cacheKey', async (req, res) => {
  try {
    const result = await updateClusterGeocodeCache({
      cacheKey: req.params.cacheKey,
      state: req.body?.state,
      city: req.body?.city,
      status: req.body?.status,
      failureReason: req.body?.failureReason,
    });
    if (!result) return res.status(404).json({ error: '캐시 항목을 찾을 수 없습니다.' });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/assets/:id/preview', async (req, res) => {
  try {
    const previewPath = await getAssetPreviewPath(req.params.id);
    if (!previewPath) return res.status(404).json({ error: 'preview를 찾을 수 없습니다.' });
    if (!previewPath.startsWith('/usr/src/app/upload/')) {
      return res.status(400).json({ error: '허용되지 않은 preview 경로입니다.' });
    }

    const localPath = path.join(uploadRoot, previewPath.replace('/usr/src/app/upload/', ''));
    return res.sendFile(localPath, (error) => {
      if (error && !res.headersSent) {
        res.status(error.statusCode || 500).json({ error: 'preview 전송 실패' });
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/assets/:id/thumbnail', async (req, res) => {
  try {
    const thumbnailPath = await getAssetThumbnailPath(req.params.id);
    if (!thumbnailPath) return res.status(404).json({ error: 'thumbnail을 찾을 수 없습니다.' });
    if (!thumbnailPath.startsWith('/usr/src/app/upload/')) {
      return res.status(400).json({ error: '허용되지 않은 thumbnail 경로입니다.' });
    }

    const localPath = path.join(uploadRoot, thumbnailPath.replace('/usr/src/app/upload/', ''));
    return res.sendFile(localPath, (error) => {
      if (error && !res.headersSent) {
        res.status(error.statusCode || 500).json({ error: 'thumbnail 전송 실패' });
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

async function main() {
  await ensureAdminTables();
  app.listen(port, () => {
    console.log(`🗺️ Immich GeoSync Admin listening on http://0.0.0.0:${port}/admin/`);
  });
}

main().catch((error) => {
  console.error('❌ admin server failed to start:', error.message);
  process.exit(1);
});
