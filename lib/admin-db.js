const { Pool } = require('pg');
const { randomUUID } = require('crypto');
const { getDbConfig } = require('./db-config');
const { matchesRule, matchesGeometryEntity, normalizeCoordinateSource, buildRuleAddress } = require('./override-rules');
const { buildClusterRuleAddress, getPolygonCentroid } = require('./cluster-rule-address');

const pool = new Pool(getDbConfig());
const adminDebugLogs = /^(1|true|yes|on)$/i.test(String(process.env.ADMIN_DEBUG_LOGS || '').trim());

function adminDebug(event, payload = {}) {
  if (!adminDebugLogs) return;
  console.log(`[admin-debug] ${JSON.stringify({ scope: 'admin-db', event, ...payload })}`);
}

function getGeocodeConfig() {
  return {
    vworldKey: (process.env.VWORLD_API_KEY || '').trim(),
    apiTimeoutMs: parseInt(process.env.NAVER_API_TIMEOUT_MS || process.env.API_TIMEOUT_MS || '10000', 10),
  };
}

async function ensureAdminTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "custom_geo_override_rules" (
      "id" UUID PRIMARY KEY,
      "name" VARCHAR NOT NULL,
      "rule_type" VARCHAR NOT NULL,
      "geometry" JSONB NOT NULL,
      "country" VARCHAR DEFAULT '대한민국',
      "state" VARCHAR DEFAULT '',
      "city" VARCHAR DEFAULT '',
      "building" VARCHAR DEFAULT '',
      "priority" INTEGER NOT NULL DEFAULT 100,
      "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
      "apply_as_override" BOOLEAN NOT NULL DEFAULT TRUE,
      "treat_as_single_cluster" BOOLEAN NOT NULL DEFAULT FALSE,
      "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query('ALTER TABLE "custom_geo_override_rules" ADD COLUMN IF NOT EXISTS "apply_as_override" BOOLEAN NOT NULL DEFAULT TRUE');
  await pool.query('ALTER TABLE "custom_geo_override_rules" ADD COLUMN IF NOT EXISTS "treat_as_single_cluster" BOOLEAN NOT NULL DEFAULT FALSE');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "custom_geo_cluster_groups" (
      "id" UUID PRIMARY KEY,
      "name" VARCHAR NOT NULL,
      "geometry" JSONB NOT NULL,
      "sources" JSONB,
      "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
      "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query('ALTER TABLE "custom_geo_cluster_groups" ADD COLUMN IF NOT EXISTS "sources" JSONB');
}

function mapRule(row) {
  return {
    id: row.id,
    name: row.name,
    ruleType: row.rule_type,
    geometry: row.geometry,
    country: row.country,
    state: row.state,
    city: row.city,
    building: row.building,
    priority: row.priority,
    enabled: row.enabled,
    applyAsOverride: row.apply_as_override,
    treatAsSingleCluster: row.treat_as_single_cluster,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listRules() {
  const res = await pool.query(`
    SELECT *
    FROM "custom_geo_override_rules"
    ORDER BY "priority" ASC, "created_at" DESC
  `);
  return res.rows.map(mapRule);
}

async function listRuleAssetCounts() {
  const [ruleRes, assetRes] = await Promise.all([
    pool.query(`
      SELECT *
      FROM "custom_geo_override_rules"
      ORDER BY "priority" ASC, "created_at" DESC
    `),
    pool.query(`
      SELECT "assetId", "latitude", "longitude"
      FROM "asset_exif"
      WHERE "latitude" IS NOT NULL
        AND "longitude" IS NOT NULL
        AND "latitude" BETWEEN 33 AND 43
        AND "longitude" BETWEEN 124 AND 132
    `),
  ]);

  const assets = assetRes.rows.map((row) => ({
    assetId: row.assetId,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
  }));

  const counts = ruleRes.rows.map((row) => {
    const rule = mapRule(row);
    let assetCount = 0;
    for (const asset of assets) {
      if (matchesRule(asset.latitude, asset.longitude, rule)) assetCount += 1;
    }
    return {
      id: rule.id,
      assetCount,
      priority: rule.priority,
      name: rule.name,
    };
  });

  return counts.sort((a, b) => (b.assetCount - a.assetCount) || (a.priority - b.priority) || String(a.name).localeCompare(String(b.name), 'ko'));
}

async function getRule(id) {
  const res = await pool.query('SELECT * FROM "custom_geo_override_rules" WHERE "id" = $1', [id]);
  return res.rows[0] ? mapRule(res.rows[0]) : null;
}

async function createRule(input) {
  const id = randomUUID();
  const res = await pool.query(`
    INSERT INTO "custom_geo_override_rules"
      ("id", "name", "rule_type", "geometry", "country", "state", "city", "building", "priority", "enabled", "apply_as_override", "treat_as_single_cluster")
    VALUES
      ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `, [
    id,
    input.name,
    input.ruleType,
    JSON.stringify(input.geometry),
    input.country || '대한민국',
    input.state || '',
    input.city || '',
    input.building || '',
    Number.isInteger(input.priority) ? input.priority : 100,
    input.enabled !== false,
    input.applyAsOverride !== false,
    input.treatAsSingleCluster === true,
  ]);
  return mapRule(res.rows[0]);
}

async function updateRule(id, input) {
  const res = await pool.query(`
    UPDATE "custom_geo_override_rules"
    SET
      "name" = $2,
      "rule_type" = $3,
      "geometry" = $4::jsonb,
      "country" = $5,
      "state" = $6,
      "city" = $7,
      "building" = $8,
      "priority" = $9,
      "enabled" = $10,
      "apply_as_override" = $11,
      "treat_as_single_cluster" = $12,
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = $1
    RETURNING *
  `, [
    id,
    input.name,
    input.ruleType,
    JSON.stringify(input.geometry),
    input.country || '대한민국',
    input.state || '',
    input.city || '',
    input.building || '',
    Number.isInteger(input.priority) ? input.priority : 100,
    input.enabled !== false,
    input.applyAsOverride !== false,
    input.treatAsSingleCluster === true,
  ]);
  return res.rows[0] ? mapRule(res.rows[0]) : null;
}

async function deleteRule(id) {
  const res = await pool.query('DELETE FROM "custom_geo_override_rules" WHERE "id" = $1', [id]);
  return (res.rowCount || 0) > 0;
}

async function listMatchingAssetsForRule(rule) {
  const res = await pool.query(`
    SELECT "assetId", "latitude", "longitude", COALESCE("state", '') AS state, COALESCE("city", '') AS city
    FROM "asset_exif"
    WHERE "latitude" IS NOT NULL
      AND "longitude" IS NOT NULL
      AND "latitude" BETWEEN 33 AND 43
      AND "longitude" BETWEEN 124 AND 132
  `);

  return res.rows.filter((row) => matchesRule(Number(row.latitude), Number(row.longitude), rule));
}

async function previewRule(id) {
  const rule = await getRule(id);
  if (!rule) return null;
  const matches = await listMatchingAssetsForRule(rule);
  return {
    rule,
    assetCount: matches.length,
    samples: matches.slice(0, 20).map((row) => ({
      assetId: row.assetId,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      state: row.state,
      city: row.city,
    })),
  };
}

async function applyRule(id) {
  const rule = await getRule(id);
  if (!rule) return null;

  if (rule.applyAsOverride === false) {
    return { rule, updatedCount: 0, skipped: true, reason: 'applyAsOverride=false' };
  }

  const matches = await listMatchingAssetsForRule(rule);
  if (matches.length === 0) {
    return { rule, updatedCount: 0 };
  }

  const address = rule.treatAsSingleCluster === true
    ? await buildClusterRuleAddress(rule, getGeocodeConfig(), {
      fallbackState: matches[0]?.state,
      fallbackCity: matches[0]?.city,
    })
    : buildRuleAddress(rule);
  const assetIds = matches.map((row) => row.assetId);
  await pool.query(
    `UPDATE "asset_exif"
     SET "country" = $2,
         "state" = $3,
         "city" = $4
     WHERE "assetId" = ANY($1::uuid[])`,
    [assetIds, address.country, address.state, address.city],
  );

  return { rule, updatedCount: assetIds.length, address };
}

function normalizeGroupSources(sources = []) {
  return (Array.isArray(sources) ? sources : [])
    .map((source) => normalizeCoordinateSource(source))
    .filter(Boolean);
}

function buildCoordinateSourceKey(latitude, longitude, precision = 5) {
  const digits = Math.max(2, Math.min(5, Number(precision) || 5));
  return `${Number(latitude).toFixed(digits)}:${Number(longitude).toFixed(digits)}:${digits}`;
}

function buildMergedGroupGeometry(sources = []) {
  const normalized = normalizeGroupSources(sources);
  if (!normalized.length) {
    return {
      type: 'Polygon',
      coordinates: [
        [126.9999, 37.4999],
        [127.0001, 37.4999],
        [127.0001, 37.5001],
        [126.9999, 37.5001],
        [126.9999, 37.4999],
      ],
    };
  }

  let minLat = normalized[0].latitude;
  let maxLat = normalized[0].latitude;
  let minLon = normalized[0].longitude;
  let maxLon = normalized[0].longitude;
  for (const source of normalized) {
    minLat = Math.min(minLat, source.latitude);
    maxLat = Math.max(maxLat, source.latitude);
    minLon = Math.min(minLon, source.longitude);
    maxLon = Math.max(maxLon, source.longitude);
  }

  const latPadding = Math.max(0.00005, (maxLat - minLat) * 0.15 || 0.00005);
  const lonPadding = Math.max(0.00005, (maxLon - minLon) * 0.15 || 0.00005);
  const south = minLat - latPadding;
  const north = maxLat + latPadding;
  const west = minLon - lonPadding;
  const east = maxLon + lonPadding;

  return {
    type: 'Polygon',
    coordinates: [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  };
}

function mapGroup(row) {
  return {
    id: row.id,
    name: row.name,
    geometry: row.geometry,
    sources: normalizeGroupSources(row.sources),
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listGroups() {
  const res = await pool.query(`
    SELECT *
    FROM "custom_geo_cluster_groups"
    ORDER BY "created_at" DESC
  `);
  return res.rows.map(mapGroup);
}

async function getGroup(id) {
  const res = await pool.query('SELECT * FROM "custom_geo_cluster_groups" WHERE "id" = $1', [id]);
  return res.rows[0] ? mapGroup(res.rows[0]) : null;
}

async function createGroup(input) {
  const id = randomUUID();
  const sources = normalizeGroupSources(input.sources);
  const geometry = input.geometry || buildMergedGroupGeometry(sources);
  const res = await pool.query(`
    INSERT INTO "custom_geo_cluster_groups"
      ("id", "name", "geometry", "sources", "enabled")
    VALUES
      ($1, $2, $3::jsonb, $4::jsonb, $5)
    RETURNING *
  `, [id, input.name, JSON.stringify(geometry), sources.length ? JSON.stringify(sources) : null, input.enabled !== false]);
  return mapGroup(res.rows[0]);
}

async function deleteGroup(id) {
  const res = await pool.query('DELETE FROM "custom_geo_cluster_groups" WHERE "id" = $1', [id]);
  return (res.rowCount || 0) > 0;
}

async function previewGroup(id) {
  const group = await getGroup(id);
  if (!group) return null;
  const matches = group.sources?.length
    ? (await queryAllClusterAssetRows()).filter((row) => matchesGeometryEntity(Number(row.latitude), Number(row.longitude), group))
    : await listMatchingAssetsForRule(group);
  const sample = matches.slice(0, 20).map((row) => ({
    assetId: row.assetId,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    state: row.state,
    city: row.city,
  }));
  return { group, assetCount: matches.length, samples: sample };
}

async function listClusters(bounds = {}) {
  const defaultBounds = {
    south: 33,
    north: 43,
    west: 124,
    east: 132,
  };

  const normalized = {
    south: Number.isFinite(Number(bounds.south)) ? Number(bounds.south) : defaultBounds.south,
    north: Number.isFinite(Number(bounds.north)) ? Number(bounds.north) : defaultBounds.north,
    west: Number.isFinite(Number(bounds.west)) ? Number(bounds.west) : defaultBounds.west,
    east: Number.isFinite(Number(bounds.east)) ? Number(bounds.east) : defaultBounds.east,
    zoom: Number.isFinite(Number(bounds.zoom)) ? Number(bounds.zoom) : 7,
  };

  const south = Math.max(defaultBounds.south, Math.min(normalized.south, normalized.north));
  const north = Math.min(defaultBounds.north, Math.max(normalized.south, normalized.north));
  const west = Math.max(defaultBounds.west, Math.min(normalized.west, normalized.east));
  const east = Math.min(defaultBounds.east, Math.max(normalized.west, normalized.east));
  const zoom = Math.max(1, Math.min(18, normalized.zoom));

  const latSpan = Math.max(0.02, north - south);
  const lonSpan = Math.max(0.02, east - west);
  const area = latSpan * lonSpan;
  const limit = zoom >= 15 ? 900 : zoom >= 13 ? 1400 : area <= 0.5 ? 2500 : 1500;
  const precision = zoom <= 8 ? 2 : zoom <= 10 ? 3 : zoom <= 12 ? 4 : 5;

  const [assetRes, ruleRes, groupRes] = await Promise.all([
    pool.query(`
      SELECT
        exif."assetId" AS asset_id,
        exif."latitude" AS latitude,
        exif."longitude" AS longitude,
        COALESCE(exif."country", '') AS country,
        COALESCE(exif."state", '') AS state,
        COALESCE(exif."city", '') AS city
      FROM "asset_exif" exif
      WHERE exif."latitude" IS NOT NULL
        AND exif."longitude" IS NOT NULL
        AND exif."latitude" BETWEEN $1 AND $2
        AND exif."longitude" BETWEEN $3 AND $4
    `, [south, north, west, east]),
    pool.query(`
      SELECT *
      FROM "custom_geo_override_rules"
      WHERE "enabled" = TRUE
        AND "rule_type" = 'polygon'
        AND "treat_as_single_cluster" = TRUE
      ORDER BY "priority" ASC, "created_at" DESC
    `),
    pool.query(`
      SELECT *
      FROM "custom_geo_cluster_groups"
      WHERE "enabled" = TRUE
      ORDER BY "created_at" DESC
    `),
  ]);

  const rules = ruleRes.rows.map(mapRule);
  const groups = groupRes.rows.map(mapGroup);
  const assignedAssetIds = new Set();
  const clusters = [];

  for (const rule of rules) {
    const centroid = getPolygonCentroid(rule.geometry);
    if (!centroid) continue;
    const matched = assetRes.rows.filter((row) => {
      if (assignedAssetIds.has(row.asset_id)) return false;
      return matchesRule(Number(row.latitude), Number(row.longitude), rule);
    });
    if (!matched.length) continue;
    matched.forEach((row) => assignedAssetIds.add(row.asset_id));
    clusters.push({
      clusterKey: `rule_${rule.id}`,
      clusterType: 'single_rule',
      ruleId: rule.id,
      name: rule.name || '',
      latitude: Number(centroid.lat),
      longitude: Number(centroid.lon),
      precision: 5,
      assetCount: matched.length,
      sampleAssetId: matched[0]?.asset_id || '',
      samplePreviewUrl: matched[0]?.asset_id ? `/api/assets/${matched[0].asset_id}/preview` : '',
      country: rule.country || matched[0]?.country || '대한민국',
      state: rule.state || matched[0]?.state || '',
      city: rule.city || matched[0]?.city || '',
    });
  }

  for (const group of groups) {
    const matched = assetRes.rows.filter((row) => {
      if (assignedAssetIds.has(row.asset_id)) return false;
      return matchesGeometryEntity(Number(row.latitude), Number(row.longitude), group);
    });
    if (!matched.length) continue;
    matched.forEach((row) => assignedAssetIds.add(row.asset_id));
    const latitude = matched.reduce((sum, row) => sum + Number(row.latitude), 0) / matched.length;
    const longitude = matched.reduce((sum, row) => sum + Number(row.longitude), 0) / matched.length;
    clusters.push({
      clusterKey: `group_${group.id}`,
      clusterType: 'manual_group',
      groupId: group.id,
      name: group.name || '',
      latitude,
      longitude,
      precision: 5,
      assetCount: matched.length,
      sampleAssetId: matched[0]?.asset_id || '',
      samplePreviewUrl: matched[0]?.asset_id ? `/api/assets/${matched[0].asset_id}/preview` : '',
      country: matched[0]?.country || '대한민국',
      state: matched[0]?.state || '',
      city: matched[0]?.city || '',
      sourceClusters: normalizeGroupSources(group.sources),
      mergedClusterCount: Math.max(1, normalizeGroupSources(group.sources).length),
      isMergedDisplayCluster: Math.max(1, normalizeGroupSources(group.sources).length) > 1,
    });
  }

  const grouped = new Map();
  for (const row of assetRes.rows) {
    if (assignedAssetIds.has(row.asset_id)) continue;
    const lat = Number(Number(row.latitude).toFixed(precision));
    const lon = Number(Number(row.longitude).toFixed(precision));
    const key = `${lat.toFixed(5)}_${lon.toFixed(5)}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        clusterKey: key,
        latitude: lat,
        longitude: lon,
        precision,
        assetCount: 0,
        sampleAssetId: row.asset_id || '',
        samplePreviewUrl: row.asset_id ? `/api/assets/${row.asset_id}/preview` : '',
        country: row.country,
        state: row.state,
        city: row.city,
      });
    }
    const cluster = grouped.get(key);
    cluster.assetCount += 1;
    if (!cluster.country && row.country) cluster.country = row.country;
    if (!cluster.state && row.state) cluster.state = row.state;
    if (!cluster.city && row.city) cluster.city = row.city;
  }

  const result = [...clusters, ...grouped.values()]
    .sort((a, b) => (b.assetCount - a.assetCount) || (a.latitude - b.latitude) || (a.longitude - b.longitude))
    .slice(0, limit);

  adminDebug('listClusters', {
    bounds: { south, north, west, east, zoom },
    precision,
    rawAssetRows: assetRes.rows.length,
    groupedRuleAndManualClusters: clusters.length,
    groupedClusters: grouped.size,
    returnedClusters: result.length,
    topClusterAssetCount: result[0]?.assetCount || 0,
  });

  return result;
}

function mapClusterAssetRow(row) {
  return {
    assetId: row.asset_id,
    originalFileName: row.original_file_name,
    fileCreatedAt: row.file_created_at,
    previewPath: row.preview_path || '',
    thumbnailPath: row.thumbnail_path || '',
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    state: row.state,
    city: row.city,
  };
}

const clusterAssetSelectSql = `
  SELECT
    exif."assetId" AS asset_id,
    asset."originalFileName" AS original_file_name,
    asset."fileCreatedAt" AS file_created_at,
    preview."path" AS preview_path,
    thumbnail."path" AS thumbnail_path,
    exif."latitude" AS latitude,
    exif."longitude" AS longitude,
    COALESCE(exif."state", '') AS state,
    COALESCE(exif."city", '') AS city
  FROM "asset_exif" exif
  JOIN "asset" asset ON asset."id" = exif."assetId"
  LEFT JOIN "asset_file" preview
    ON preview."assetId" = asset."id"
   AND preview."type" = 'preview'
   AND preview."isEdited" = FALSE
  LEFT JOIN "asset_file" thumbnail
    ON thumbnail."assetId" = asset."id"
   AND thumbnail."type" = 'thumbnail'
   AND thumbnail."isEdited" = FALSE
`;

function normalizeClusterAssetPage(rows, limit = 12, offset = 0) {
  const pageOffset = Math.max(0, Number(offset) || 0);
  const pageLimit = Math.max(1, Math.min(30, Number(limit) || 12));
  return rows.slice(pageOffset, pageOffset + pageLimit).map(mapClusterAssetRow);
}

async function queryAllClusterAssetRows() {
  const res = await pool.query(`
    ${clusterAssetSelectSql}
    WHERE exif."latitude" IS NOT NULL
      AND exif."longitude" IS NOT NULL
      AND exif."latitude" BETWEEN 33 AND 43
      AND exif."longitude" BETWEEN 124 AND 132
    ORDER BY asset."fileCreatedAt" DESC
  `);
  return res.rows;
}

async function queryClusterAssetRowsByRoundedGroups(groups = [], limit = 12, offset = 0) {
  const normalizedGroups = (Array.isArray(groups) ? groups : [])
    .map((group) => ({
      latitude: Number(group?.latitude),
      longitude: Number(group?.longitude),
      precision: Math.max(2, Math.min(5, Number(group?.precision) || 5)),
    }))
    .filter((group) => Number.isFinite(group.latitude) && Number.isFinite(group.longitude));

  if (!normalizedGroups.length) return [];

  const pageLimit = Math.max(1, Math.min(30, Number(limit) || 12));
  const pageOffset = Math.max(0, Number(offset) || 0);
  const targetCount = pageOffset + pageLimit;
  const chunkSize = Math.max(200, pageLimit * 12);
  const maxDelta = normalizedGroups.reduce((value, group) => Math.max(value, 0.6 * (10 ** -group.precision)), 0.00001);
  const south = Math.min(...normalizedGroups.map((group) => group.latitude)) - maxDelta;
  const north = Math.max(...normalizedGroups.map((group) => group.latitude)) + maxDelta;
  const west = Math.min(...normalizedGroups.map((group) => group.longitude)) - maxDelta;
  const east = Math.max(...normalizedGroups.map((group) => group.longitude)) + maxDelta;
  const keys = new Set(normalizedGroups.map((group) => `${group.latitude.toFixed(group.precision)}:${group.longitude.toFixed(group.precision)}:${group.precision}`));
  const matchedRows = [];
  let scanOffset = 0;

  while (matchedRows.length < targetCount) {
    const res = await pool.query(`
      ${clusterAssetSelectSql}
      WHERE exif."latitude" IS NOT NULL
        AND exif."longitude" IS NOT NULL
        AND exif."latitude" BETWEEN $1 AND $2
        AND exif."longitude" BETWEEN $3 AND $4
      ORDER BY asset."fileCreatedAt" DESC
      LIMIT $5 OFFSET $6
    `, [south, north, west, east, chunkSize, scanOffset]);

    if (!res.rows.length) break;

    matchedRows.push(...res.rows.filter((row) => {
      for (const group of normalizedGroups) {
        const key = `${Number(row.latitude).toFixed(group.precision)}:${Number(row.longitude).toFixed(group.precision)}:${group.precision}`;
        if (keys.has(key)) return true;
      }
      return false;
    }));

    if (res.rows.length < chunkSize) break;
    scanOffset += chunkSize;
  }

  return matchedRows.slice(pageOffset, pageOffset + pageLimit);
}

async function getRuleClusterAssets(ruleId, limit = 12, offset = 0) {
  const rule = await getRule(ruleId);
  if (!rule) return [];

  const rows = await queryAllClusterAssetRows();
  const matched = rows.filter((row) => matchesRule(Number(row.latitude), Number(row.longitude), rule));
  const page = normalizeClusterAssetPage(matched, limit, offset);
  adminDebug('getRuleClusterAssets', {
    ruleId,
    limit,
    offset,
    matchedCount: matched.length,
    returnedCount: page.length,
  });
  return page;
}

async function getClusterAssets(latitude, longitude, limit = 12, precision = 5, offset = 0) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  const digits = Math.max(2, Math.min(5, Number(precision) || 5));
  const pageOffset = Math.max(0, Number(offset) || 0);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];

  const pageLimit = Math.max(1, Math.min(30, Number(limit) || 12));
  const res = await pool.query(`
    ${clusterAssetSelectSql}
    WHERE ROUND(CAST(exif."latitude" AS numeric), $3) = $1
      AND ROUND(CAST(exif."longitude" AS numeric), $3) = $2
    ORDER BY asset."fileCreatedAt" DESC
    LIMIT $4 OFFSET $5
  `, [lat.toFixed(digits), lon.toFixed(digits), digits, pageLimit, pageOffset]);

  const result = res.rows.map(mapClusterAssetRow);
  adminDebug('getClusterAssets', {
    latitude: lat,
    longitude: lon,
    precision: digits,
    limit: pageLimit,
    offset: pageOffset,
    returnedCount: result.length,
  });
  return result;
}

async function listAssetIdsForRule(rule) {
  const res = await pool.query(`
    SELECT "assetId", "latitude", "longitude"
    FROM "asset_exif"
    WHERE "latitude" IS NOT NULL
      AND "longitude" IS NOT NULL
      AND "latitude" BETWEEN 33 AND 43
      AND "longitude" BETWEEN 124 AND 132
  `);

  return res.rows
    .filter((row) => matchesRule(Number(row.latitude), Number(row.longitude), rule))
    .map((row) => row.assetId);
}

async function ensureClusterGeocodeCacheTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "custom_naver_geocode_cache" (
      "cache_key" VARCHAR PRIMARY KEY,
      "state" VARCHAR,
      "city" VARCHAR,
      "status" VARCHAR,
      "failure_reason" VARCHAR,
      "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function upsertClusterGeocodeCache(cacheKey, state, city) {
  await ensureClusterGeocodeCacheTable();

  await pool.query(`
    INSERT INTO "custom_naver_geocode_cache" ("cache_key", "state", "city", "status", "failure_reason", "updated_at")
    VALUES ($1, $2, $3, 'success', '', CURRENT_TIMESTAMP)
    ON CONFLICT ("cache_key") DO UPDATE
    SET "state" = EXCLUDED."state",
        "city" = EXCLUDED."city",
        "status" = EXCLUDED."status",
        "failure_reason" = EXCLUDED."failure_reason",
        "updated_at" = CURRENT_TIMESTAMP
  `, [cacheKey, state, city]);
}

async function deleteClusterGeocodeCaches(cacheKeys = []) {
  const normalized = [...new Set((Array.isArray(cacheKeys) ? cacheKeys : []).map((key) => String(key || '').trim()).filter(Boolean))];
  if (!normalized.length) return 0;
  await ensureClusterGeocodeCacheTable();
  const res = await pool.query(`DELETE FROM "custom_naver_geocode_cache" WHERE "cache_key" = ANY($1::varchar[])`, [normalized]);
  return res.rowCount || 0;
}

function getDefaultClusterRadiusMeters() {
  return Math.max(1, parseInt(process.env.CLUSTER_RADIUS_METERS || '15', 10) || 15);
}

function buildMergeSourceCacheKeys(source) {
  const normalized = normalizeCoordinateSource(source);
  if (!normalized) return [];
  const base = `${normalized.latitude.toFixed(5)}_${normalized.longitude.toFixed(5)}`;
  return [base, `${base}_${getDefaultClusterRadiusMeters()}`];
}

function getConsensusAddressFromSources(sources = []) {
  const normalized = (Array.isArray(sources) ? sources : []).map((source) => ({
    state: String(source?.state || '').trim(),
    city: String(source?.city || '').trim(),
  }));
  if (!normalized.length) return null;
  const first = normalized[0];
  if (!first.state && !first.city) return null;
  const same = normalized.every((item) => item.state === first.state && item.city === first.city);
  return same ? first : null;
}

async function mergeCoordinateClusters({ name = '', sources = [] } = {}) {
  const normalizedSources = [...new Map(normalizeGroupSources(sources).map((source) => [buildCoordinateSourceKey(source.latitude, source.longitude, source.precision), source])).values()];
  if (normalizedSources.length < 2) {
    throw new Error('병합하려면 최소 2개의 최소 클러스터가 필요합니다.');
  }

  const groupName = String(name || '').trim() || `병합 클러스터 ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`;
  const group = await createGroup({
    name: groupName,
    sources: normalizedSources,
    geometry: buildMergedGroupGeometry(normalizedSources),
    enabled: true,
  });

  const cacheKey = `manual-group:${group.id}`;
  const consensus = getConsensusAddressFromSources(sources);
  let cacheAction = 'recompute';
  if (consensus) {
    await upsertClusterGeocodeCache(cacheKey, consensus.state, consensus.city);
    cacheAction = 'seeded';
  } else {
    await deleteClusterGeocodeCaches([cacheKey]);
  }

  const staleKeys = normalizedSources.flatMap((source) => buildMergeSourceCacheKeys(source));
  const deletedCacheCount = await deleteClusterGeocodeCaches(staleKeys);

  adminDebug('mergeCoordinateClusters', {
    groupId: group.id,
    sourceCount: normalizedSources.length,
    cacheAction,
    deletedCacheCount,
  });

  return {
    group,
    cacheKey,
    cacheAction,
    deletedCacheCount,
    mergedSourceCount: normalizedSources.length,
  };
}

async function getCoordinateClusterAssetIds(latitude, longitude, precision = 5) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  const digits = Math.max(2, Math.min(5, Number(precision) || 5));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('유효한 클러스터 좌표가 필요합니다.');
  }

  const res = await pool.query(`
    SELECT "assetId"
    FROM "asset_exif" exif
    WHERE ROUND(CAST(exif."latitude" AS numeric), $3) = $1
      AND ROUND(CAST(exif."longitude" AS numeric), $3) = $2
  `, [lat.toFixed(digits), lon.toFixed(digits), digits]);

  return {
    assetIds: res.rows.map((row) => row.assetId),
    digits,
    latitude: lat,
    longitude: lon,
  };
}

async function updateClusterAddress({ ruleId = '', latitude, longitude, precision = 5, state = '', city = '' } = {}) {
  const normalizedState = String(state || '').trim();
  const normalizedCity = String(city || '').trim();

  let assetIds = [];
  let rule = null;
  if (ruleId) {
    rule = await getRule(ruleId);
    if (!rule) return null;
    assetIds = await listAssetIdsForRule(rule);
  } else {
    const cluster = await getCoordinateClusterAssetIds(latitude, longitude, precision);
    assetIds = cluster.assetIds;
  }

  if (!assetIds.length) {
    return { updatedCount: 0, state: normalizedState, city: normalizedCity };
  }

  await pool.query(
    `UPDATE "asset_exif"
     SET "country" = '대한민국',
         "state" = $2,
         "city" = $3
     WHERE "assetId" = ANY($1::uuid[])`,
    [assetIds, normalizedState, normalizedCity],
  );

  let cacheKey = null;
  if (rule?.treatAsSingleCluster === true) {
    cacheKey = `manual-group:${rule.id}`;
    await upsertClusterGeocodeCache(cacheKey, normalizedState, normalizedCity);
  }

  adminDebug('updateClusterAddress', {
    ruleId: ruleId || null,
    latitude: Number.isFinite(Number(latitude)) ? Number(latitude) : null,
    longitude: Number.isFinite(Number(longitude)) ? Number(longitude) : null,
    precision: Number(precision) || 5,
    updatedCount: assetIds.length,
    state: normalizedState,
    city: normalizedCity,
    cacheKey,
  });

  return { updatedCount: assetIds.length, state: normalizedState, city: normalizedCity, cacheKey };
}

async function updateClusterCoordinates({ latitude, longitude, precision = 5, nextLatitude, nextLongitude } = {}) {
  const cluster = await getCoordinateClusterAssetIds(latitude, longitude, precision);
  const normalizedNextLatitude = Number(nextLatitude);
  const normalizedNextLongitude = Number(nextLongitude);

  if (!Number.isFinite(normalizedNextLatitude) || !Number.isFinite(normalizedNextLongitude)) {
    throw new Error('변경할 좌표가 올바르지 않습니다.');
  }

  if (!cluster.assetIds.length) {
    return {
      updatedCount: 0,
      latitude: normalizedNextLatitude,
      longitude: normalizedNextLongitude,
      precision: cluster.digits,
    };
  }

  await pool.query(
    `UPDATE "asset_exif"
     SET "latitude" = $2,
         "longitude" = $3
     WHERE "assetId" = ANY($1::uuid[])`,
    [cluster.assetIds, normalizedNextLatitude, normalizedNextLongitude],
  );

  adminDebug('updateClusterCoordinates', {
    latitude: cluster.latitude,
    longitude: cluster.longitude,
    nextLatitude: normalizedNextLatitude,
    nextLongitude: normalizedNextLongitude,
    precision: cluster.digits,
    updatedCount: cluster.assetIds.length,
  });

  return {
    updatedCount: cluster.assetIds.length,
    latitude: normalizedNextLatitude,
    longitude: normalizedNextLongitude,
    precision: cluster.digits,
  };
}

async function getMergedClusterAssets(sources = [], limit = 12, offset = 0) {
  const pageLimit = Math.max(1, Math.min(30, Number(limit) || 12));
  const pageOffset = Math.max(0, Number(offset) || 0);
  const targetCount = pageOffset + pageLimit;
  const sourceResults = await Promise.all((Array.isArray(sources) ? sources : []).map(async (source) => {
    if (source?.ruleId) {
      const rows = await getRuleClusterAssets(source.ruleId, targetCount, 0);
      return {
        stat: { type: 'rule', ruleId: source.ruleId, fetchedCount: rows.length },
        rows: rows.map((row) => ({
          asset_id: row.assetId,
          original_file_name: row.originalFileName,
          file_created_at: row.fileCreatedAt,
          preview_path: row.previewPath,
          thumbnail_path: row.thumbnailPath,
          latitude: row.latitude,
          longitude: row.longitude,
          state: row.state,
          city: row.city,
        })),
      };
    }

    const rows = await getClusterAssets(source.latitude, source.longitude, targetCount, source.precision, 0);
    return {
      stat: {
        type: 'coordinate',
        latitude: Number(source.latitude),
        longitude: Number(source.longitude),
        precision: Number(source.precision) || 5,
        fetchedCount: rows.length,
      },
      rows: rows.map((row) => ({
        asset_id: row.assetId,
        original_file_name: row.originalFileName,
        file_created_at: row.fileCreatedAt,
        preview_path: row.previewPath,
        thumbnail_path: row.thumbnailPath,
        latitude: row.latitude,
        longitude: row.longitude,
        state: row.state,
        city: row.city,
      })),
    };
  }));

  const sourceStats = sourceResults.map((item) => item.stat);
  const allRows = sourceResults.flatMap((item) => item.rows);

  const deduped = [];
  const seen = new Set();
  for (const row of allRows) {
    if (seen.has(row.asset_id)) continue;
    seen.add(row.asset_id);
    deduped.push(row);
  }

  deduped.sort((a, b) => new Date(b.file_created_at).getTime() - new Date(a.file_created_at).getTime());
  const result = normalizeClusterAssetPage(deduped, limit, offset);
  adminDebug('getMergedClusterAssets', {
    sourceCount: Array.isArray(sources) ? sources.length : 0,
    limit: pageLimit,
    offset: pageOffset,
    targetCount,
    fetchedRowCount: allRows.length,
    dedupedCount: deduped.length,
    returnedCount: result.length,
    sourceStats,
  });
  return result;
}

async function getAssetPreviewPath(assetId) {
  const res = await pool.query(`
    SELECT COALESCE(preview."path", thumbnail."path", '') AS path
    FROM "asset" asset
    LEFT JOIN "asset_file" preview
      ON preview."assetId" = asset."id"
     AND preview."type" = 'preview'
     AND preview."isEdited" = FALSE
    LEFT JOIN "asset_file" thumbnail
      ON thumbnail."assetId" = asset."id"
     AND thumbnail."type" = 'thumbnail'
     AND thumbnail."isEdited" = FALSE
    WHERE asset."id" = $1
    LIMIT 1
  `, [assetId]);

  return res.rows[0]?.path || '';
}

async function getAssetThumbnailPath(assetId) {
  const res = await pool.query(`
    SELECT COALESCE(thumbnail."path", preview."path", '') AS path
    FROM "asset" asset
    LEFT JOIN "asset_file" thumbnail
      ON thumbnail."assetId" = asset."id"
     AND thumbnail."type" = 'thumbnail'
     AND thumbnail."isEdited" = FALSE
    LEFT JOIN "asset_file" preview
      ON preview."assetId" = asset."id"
     AND preview."type" = 'preview'
     AND preview."isEdited" = FALSE
    WHERE asset."id" = $1
    LIMIT 1
  `, [assetId]);

  return res.rows[0]?.path || '';
}

module.exports = {
  pool,
  ensureAdminTables,
  listRules,
  listRuleAssetCounts,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  previewRule,
  applyRule,
  listGroups,
  getGroup,
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
  getAssetPreviewPath,
  getAssetThumbnailPath,
};
