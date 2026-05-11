const { Pool } = require('pg');
const { randomUUID } = require('crypto');
const { getDbConfig } = require('./db-config');
const { matchesRule, buildRuleAddress } = require('./override-rules');
const { buildClusterRuleAddress, getPolygonCentroid } = require('./cluster-rule-address');

const pool = new Pool(getDbConfig());

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
      "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
      "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
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

function mapGroup(row) {
  return {
    id: row.id,
    name: row.name,
    geometry: row.geometry,
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
  const res = await pool.query(`
    INSERT INTO "custom_geo_cluster_groups"
      ("id", "name", "geometry", "enabled")
    VALUES
      ($1, $2, $3::jsonb, $4)
    RETURNING *
  `, [id, input.name, JSON.stringify(input.geometry), input.enabled !== false]);
  return mapGroup(res.rows[0]);
}

async function deleteGroup(id) {
  const res = await pool.query('DELETE FROM "custom_geo_cluster_groups" WHERE "id" = $1', [id]);
  return (res.rowCount || 0) > 0;
}

async function previewGroup(id) {
  const group = await getGroup(id);
  if (!group) return null;
  const matches = await listMatchingAssetsForRule(group);
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
  const limit = latSpan * lonSpan <= 0.5 ? 2500 : 1500;
  const precision = zoom <= 8 ? 2 : zoom <= 10 ? 3 : zoom <= 12 ? 4 : 5;

  const [assetRes, ruleRes] = await Promise.all([
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
  ]);

  const rules = ruleRes.rows.map(mapRule);
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

  return [...clusters, ...grouped.values()]
    .sort((a, b) => (b.assetCount - a.assetCount) || (a.latitude - b.latitude) || (a.longitude - b.longitude))
    .slice(0, limit);
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
  return normalizeClusterAssetPage(
    rows.filter((row) => matchesRule(Number(row.latitude), Number(row.longitude), rule)),
    limit,
    offset,
  );
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

  return res.rows.map(mapClusterAssetRow);
}

async function getMergedClusterAssets(sources = [], limit = 12, offset = 0) {
  const pageLimit = Math.max(1, Math.min(30, Number(limit) || 12));
  const pageOffset = Math.max(0, Number(offset) || 0);
  const targetCount = pageOffset + pageLimit;
  const allRows = [];

  for (const source of Array.isArray(sources) ? sources : []) {
    if (source?.ruleId) {
      const rows = await getRuleClusterAssets(source.ruleId, targetCount, 0);
      allRows.push(...rows.map((row) => ({
        asset_id: row.assetId,
        original_file_name: row.originalFileName,
        file_created_at: row.fileCreatedAt,
        preview_path: row.previewPath,
        thumbnail_path: row.thumbnailPath,
        latitude: row.latitude,
        longitude: row.longitude,
        state: row.state,
        city: row.city,
      })));
      continue;
    }

    const rows = await getClusterAssets(source.latitude, source.longitude, targetCount, source.precision, 0);
    allRows.push(...rows.map((row) => ({
      asset_id: row.assetId,
      original_file_name: row.originalFileName,
      file_created_at: row.fileCreatedAt,
      preview_path: row.previewPath,
      thumbnail_path: row.thumbnailPath,
      latitude: row.latitude,
      longitude: row.longitude,
      state: row.state,
      city: row.city,
    })));
  }

  const deduped = [];
  const seen = new Set();
  for (const row of allRows) {
    if (seen.has(row.asset_id)) continue;
    seen.add(row.asset_id);
    deduped.push(row);
  }

  deduped.sort((a, b) => new Date(b.file_created_at).getTime() - new Date(a.file_created_at).getTime());
  return normalizeClusterAssetPage(deduped, limit, offset);
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
  getAssetPreviewPath,
  getAssetThumbnailPath,
};
