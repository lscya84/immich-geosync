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

app.get('/map-styles/light.json', (req, res) => {
  res.json(buildRasterMapStyle({
    name: 'Immich KO Geo Admin Light',
    tileUrl: mapStyleLightTileUrl,
    attribution: mapStyleLightAttribution,
  }));
});

app.get('/map-styles/dark.json', (req, res) => {
  res.json(buildRasterMapStyle({
    name: 'Immich KO Geo Admin Dark',
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
    const assets = ruleId
      ? await getRuleClusterAssets(ruleId, limit, offset)
      : await getClusterAssets(latitude, longitude, limit, precision, offset);
    res.json({
      assets: assets.map((asset) => ({
        ...asset,
        previewUrl: `/api/assets/${asset.assetId}/preview`,
        thumbnailUrl: `/api/assets/${asset.assetId}/thumbnail`,
      })),
    });
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
