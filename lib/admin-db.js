const { Pool } = require('pg');
const { randomUUID } = require('crypto');
const { getDbConfig } = require('./db-config');
const { matchesRule, buildRuleAddress } = require('./override-rules');

const pool = new Pool(getDbConfig());

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

  const address = buildRuleAddress(rule);
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

async function listClusters() {
  const res = await pool.query(`
    SELECT
      ROUND(CAST("latitude" AS numeric), 5) AS latitude,
      ROUND(CAST("longitude" AS numeric), 5) AS longitude,
      COUNT(*) AS asset_count,
      MAX(COALESCE("country", '')) AS country,
      MAX(COALESCE("state", '')) AS state,
      MAX(COALESCE("city", '')) AS city
    FROM "asset_exif"
    WHERE "latitude" IS NOT NULL
      AND "longitude" IS NOT NULL
      AND "latitude" BETWEEN 33 AND 43
      AND "longitude" BETWEEN 124 AND 132
    GROUP BY 1, 2
    ORDER BY asset_count DESC, latitude ASC, longitude ASC
    LIMIT 5000
  `);

  return res.rows.map((row) => ({
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    assetCount: Number(row.asset_count),
    country: row.country,
    state: row.state,
    city: row.city,
  }));
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
};
