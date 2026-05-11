const path = require('path');
const express = require('express');
const { reverseGeocode } = require('./lib/geocode');
const { getPolygonCentroid } = require('./lib/cluster-rule-address');
const {
  ensureAdminTables,
  listRules,
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
const naverStaticMapKeyId = (process.env.NAVER_STATIC_MAP_KEY_ID || process.env.NAVER_CLIENT_ID || '').trim();
const naverStaticMapKey = (process.env.NAVER_STATIC_MAP_KEY || process.env.NAVER_CLIENT_SECRET || '').trim();
const naverStaticMapLightType = (process.env.NAVER_STATIC_MAP_LIGHT_MAPTYPE || 'basic').trim() || 'basic';
const naverStaticMapDarkType = (process.env.NAVER_STATIC_MAP_DARK_MAPTYPE || naverStaticMapLightType).trim() || naverStaticMapLightType;
const naverStaticMapFormat = (process.env.NAVER_STATIC_MAP_FORMAT || 'png').trim() || 'png';
const naverStaticMapScale = Math.max(1, Math.min(2, parseInt(process.env.NAVER_STATIC_MAP_SCALE || '1', 10) || 1));
const naverStaticMapMaxZoom = Math.max(0, Math.min(20, parseInt(process.env.NAVER_STATIC_MAP_MAX_ZOOM || '18', 10) || 18));

app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

function buildRasterMapStyle({ name, tileUrl, attribution, maxzoom = mapStyleMaxZoom }) {
  return {
    version: 8,
    name,
    sources: {
      basemap: {
        type: 'raster',
        tiles: [tileUrl],
        tileSize: 256,
        attribution,
        maxzoom,
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

function slippyTileToLon(x, z) {
  return (x / (2 ** z)) * 360 - 180;
}

function slippyTileToLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / (2 ** z);
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

function getTileCenter(z, x, y) {
  const zoom = Number(z);
  const tileX = Number(x);
  const tileY = Number(y);
  return {
    lon: (slippyTileToLon(tileX, zoom) + slippyTileToLon(tileX + 1, zoom)) / 2,
    lat: (slippyTileToLat(tileY, zoom) + slippyTileToLat(tileY + 1, zoom)) / 2,
  };
}

function getNaverStaticTileUrl(req, variant) {
  const format = naverStaticMapFormat.replace(/^\./, '');
  return `${req.protocol}://${req.get('host')}/map-tiles/naver/${variant}/{z}/{x}/{y}.${format}`;
}

async function fetchNaverStaticTile({ z, x, y, maptype }) {
  if (!naverStaticMapKeyId || !naverStaticMapKey) {
    throw new Error('NAVER static map API key is not configured');
  }

  const zoom = Math.max(0, Math.min(naverStaticMapMaxZoom, Number(z) || 0));
  const { lon, lat } = getTileCenter(zoom, Number(x), Number(y));
  const url = new URL('https://maps.apigw.ntruss.com/map-static/v2/raster');
  url.searchParams.set('w', '256');
  url.searchParams.set('h', '256');
  url.searchParams.set('center', `${lon},${lat}`);
  url.searchParams.set('level', String(zoom));
  url.searchParams.set('maptype', maptype);
  url.searchParams.set('format', naverStaticMapFormat);
  url.searchParams.set('scale', String(naverStaticMapScale));

  const response = await fetch(url, {
    headers: {
      'X-NCP-APIGW-API-KEY-ID': naverStaticMapKeyId,
      'X-NCP-APIGW-API-KEY': naverStaticMapKey,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Naver static map tile fetch failed (${response.status}): ${body.slice(0, 200)}`);
  }

  return response;
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

app.get('/map-styles/light.json', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cache-Control', 'public, max-age=300');
  res.json(buildRasterMapStyle({
    name: 'Immich KO Geo Admin Light',
    tileUrl: mapStyleLightTileUrl,
    attribution: mapStyleLightAttribution,
  }));
});

app.get('/map-styles/dark.json', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cache-Control', 'public, max-age=300');
  res.json(buildRasterMapStyle({
    name: 'Immich KO Geo Admin Dark',
    tileUrl: mapStyleDarkTileUrl,
    attribution: mapStyleDarkAttribution,
  }));
});

app.get('/map-styles/naver-light.json', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cache-Control', 'public, max-age=300');
  res.json(buildRasterMapStyle({
    name: 'Immich KO Geo Admin Naver Light',
    tileUrl: getNaverStaticTileUrl(req, 'light'),
    attribution: '© NAVER Cloud',
    maxzoom: naverStaticMapMaxZoom,
  }));
});

app.get('/map-styles/naver-dark.json', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cache-Control', 'public, max-age=300');
  res.json(buildRasterMapStyle({
    name: 'Immich KO Geo Admin Naver Dark',
    tileUrl: getNaverStaticTileUrl(req, 'dark'),
    attribution: '© NAVER Cloud',
    maxzoom: naverStaticMapMaxZoom,
  }));
});

app.get('/map-tiles/naver/:variant/:z/:x/:y.:format', async (req, res) => {
  const variant = String(req.params.variant || 'light').trim() === 'dark' ? 'dark' : 'light';
  const z = Number(req.params.z);
  const x = Number(req.params.x);
  const y = Number(req.params.y);
  if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return res.status(400).json({ error: 'invalid tile coordinates' });
  }

  try {
    const response = await fetchNaverStaticTile({
      z,
      x,
      y,
      maptype: variant === 'dark' ? naverStaticMapDarkType : naverStaticMapLightType,
    });
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=86400');
    res.type(response.headers.get('content-type') || 'image/png');
    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
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
      preferBuildingName: true,
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
        city: result.summary.buildingName || result.summary.city || '',
        buildingName: result.summary.buildingName || '',
        fallbackCity: result.summary.city || '',
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
    res.json({ clusters: await listClusters(bounds) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function withAssetUrls(assets = []) {
  return assets.map((asset) => ({
    ...asset,
    previewUrl: `/api/assets/${asset.assetId}/preview`,
    thumbnailUrl: `/api/assets/${asset.assetId}/thumbnail`,
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
    res.json(paginateAssets(assets, pageLimit));
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
    res.json(paginateAssets(assets, pageLimit));
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
    console.log(`🗺️ Cluster Map Editor listening on http://0.0.0.0:${port}/admin/`);
  });
}

main().catch((error) => {
  console.error('❌ admin server failed to start:', error.message);
  process.exit(1);
});
