require('dotenv').config({ path: '/app/.env', quiet: true });
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { reverseGeocode, translateLocation } = require('./lib/geocode');
const { findMatchingRule, findMatchingGeometryEntity, buildRuleAddress } = require('./lib/override-rules');
const { buildClusterRuleAddress } = require('./lib/cluster-rule-address');
const { clusterRowsByGrid, selectRepresentativeCoordinate, partitionRowsByRules } = require('./lib/spatial-clustering');
const {
    normalizeAdministrativeKey,
    isSouthKoreanAddress,
    isWithinSouthKoreaBoundary,
    getBoundaryValidationPoints,
} = require('./lib/address-validation');
const {
    ensureWorkerMonitorTables,
    startWorkerRun,
    finishWorkerRun,
    appendWorkerLog,
} = require('./lib/worker-monitor');

const config = {
    naverId: (process.env.NAVER_CLIENT_ID || '').trim(),
    naverSecret: (process.env.NAVER_CLIENT_SECRET || '').trim(),
    vworldKey: (process.env.VWORLD_API_KEY || '').trim(),
    db: {
        user: (process.env.DB_USERNAME || 'postgres').trim(),
        password: (process.env.DB_PASSWORD || '').trim(),
        host: (process.env.DB_HOSTNAME || 'immich_postgres').trim(),
        database: (process.env.DB_DATABASE_NAME || 'immich').trim(),
        port: parseInt(process.env.DB_PORT || '5432', 10),
    },
    interval: parseInt(process.env.INTERVAL_HOURS || '24', 10) * 60 * 60 * 1000,
    delay: parseInt(process.env.STEP_DELAY_MS || '100', 10),
    apiTimeoutMs: parseInt(process.env.NAVER_API_TIMEOUT_MS || process.env.API_TIMEOUT_MS || '10000', 10),
    clusterRadiusMeters: parseInt(process.env.CLUSTER_RADIUS_METERS || '15', 10),
    clusterYieldInterval: parseInt(process.env.CLUSTER_YIELD_INTERVAL || '1000', 10),
    appendBuildingName: String(process.env.APPEND_BUILDING_NAME || 'true').toLowerCase() === 'true',
    dbRetryLimit: parseInt(process.env.DB_RETRY_LIMIT || '10', 10),
    dbRetryDelayMs: parseInt(process.env.DB_RETRY_DELAY_MS || '2000', 10),
    boundaryValidationMinSpanMeters: parseInt(process.env.BOUNDARY_VALIDATION_MIN_SPAN_METERS || '10', 10),
};

const isForceMode = process.argv.includes('--force');
const shouldClearCache = process.argv.includes('--clear-cache');
const clearCacheOnly = process.argv.includes('--clear-cache-only');
let locationMap = {};

const addressCache = new Map();
const MAX_CACHE_SIZE = 50000;
const CACHE_TTL_DAYS = 180;
const NOT_FOUND_CACHE_TTL_DAYS = parseInt(process.env.NOT_FOUND_CACHE_TTL_DAYS || '30', 10);

const FAST_TRACK_CHUNK_SIZE = 2000;
const DB_UPDATE_CHUNK_SIZE = 1000;
const FAST_TRACK_LOG_INTERVAL = 10000;
const API_TRACK_LOG_INTERVAL = 50;
const API_FAILURE_LOG_LIMIT = 5;
const SOUTH_KOREA_BOUNDS = { south: 32.8, north: 38.7, west: 124.5, east: 132 };

let isRunning = false;
let activeRunId = null;
let activeLogClient = null;
const pendingLogWrites = new Set();
const originalConsole = { ...console };

function getWorkerRuntimeConfig() {
    return {
        intervalHours: parseInt(process.env.INTERVAL_HOURS || '24', 10),
        stepDelayMs: config.delay,
        apiTimeoutMs: config.apiTimeoutMs,
        clusterRadiusMeters: config.clusterRadiusMeters,
        clusterYieldInterval: config.clusterYieldInterval,
        appendBuildingName: config.appendBuildingName,
        notFoundCacheTtlDays: NOT_FOUND_CACHE_TTL_DAYS,
        boundaryValidationMinSpanMeters: config.boundaryValidationMinSpanMeters,
    };
}

function stringifyLogArg(arg) {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return arg.stack || arg.message;
    try {
        return JSON.stringify(arg);
    } catch (error) {
        return String(arg);
    }
}

function mirrorConsoleToDb(level, args) {
    if (!activeLogClient || !activeRunId) return;
    const writePromise = appendWorkerLog(activeLogClient, {
        runId: activeRunId,
        level,
        message: args.map(stringifyLogArg).join(' '),
    }).catch((error) => {
        originalConsole.warn(`[${nowKst()}] ⚠️ 워커 로그 DB 저장 실패: ${error.message}`);
    }).finally(() => {
        pendingLogWrites.delete(writePromise);
    });
    pendingLogWrites.add(writePromise);
}

console.log = (...args) => {
    originalConsole.log(...args);
    mirrorConsoleToDb('info', args);
};
console.warn = (...args) => {
    originalConsole.warn(...args);
    mirrorConsoleToDb('warn', args);
};
console.error = (...args) => {
    originalConsole.error(...args);
    mirrorConsoleToDb('error', args);
};

try {
    const mappingPath = path.join(__dirname, 'mapping.json');
    if (fs.existsSync(mappingPath)) {
        locationMap = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
    }
} catch (e) {}

function nowKst() {
    return new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

function getCacheKey(lat, lon) {
    return `${parseFloat(lat).toFixed(5)}_${parseFloat(lon).toFixed(5)}`;
}

function buildClusterKey(lat, lon, radiusMeters = 15) {
    return `${parseFloat(lat).toFixed(5)}_${parseFloat(lon).toFixed(5)}_${radiusMeters}`;
}

function getGeoCacheKeyForCluster(cluster) {
    if (cluster?.geoCacheKey) return cluster.geoCacheKey;
    if (Number.isFinite(cluster?.centroidLat) && Number.isFinite(cluster?.centroidLon)) {
        return buildClusterKey(cluster.centroidLat, cluster.centroidLon, config.clusterRadiusMeters);
    }
    return cluster?.clusterKey;
}

function setMemoryCache(cacheKey, value, enforceLimit = true) {
    if (enforceLimit && addressCache.size >= MAX_CACHE_SIZE) {
        const firstKey = addressCache.keys().next().value;
        addressCache.delete(firstKey);
    }
    addressCache.set(cacheKey, value);
}

async function ensureCacheTable(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS "custom_geo_geocode_cache" (
            "cache_key" VARCHAR PRIMARY KEY,
            "country" VARCHAR,
            "state" VARCHAR,
            "city" VARCHAR,
            "legal_dong" VARCHAR,
            "road_address" TEXT,
            "jibun_address" TEXT,
            "building_name" VARCHAR,
            "provider" VARCHAR,
            "provider_agreement" BOOLEAN,
            "validation_status" VARCHAR,
            "validation_details" JSONB,
            "status" VARCHAR,
            "failure_reason" VARCHAR,
            "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `);
    await client.query(`ALTER TABLE "custom_geo_geocode_cache" ADD COLUMN IF NOT EXISTS "status" VARCHAR`);
    await client.query(`ALTER TABLE "custom_geo_geocode_cache" ADD COLUMN IF NOT EXISTS "failure_reason" VARCHAR`);
    const structuredColumns = [
        ['country', 'VARCHAR'], ['legal_dong', 'VARCHAR'], ['road_address', 'TEXT'],
        ['jibun_address', 'TEXT'], ['building_name', 'VARCHAR'], ['provider', 'VARCHAR'],
        ['provider_agreement', 'BOOLEAN'], ['validation_status', 'VARCHAR'], ['validation_details', 'JSONB'],
    ];
    for (const [column, type] of structuredColumns) {
        await client.query(`ALTER TABLE "custom_geo_geocode_cache" ADD COLUMN IF NOT EXISTS "${column}" ${type}`);
    }
}

async function warmUpCache(client) {
    addressCache.clear();

    const res = await client.query(
        `SELECT "cache_key", "country", "state", "city", "legal_dong", "road_address", "jibun_address",
                "building_name", "provider", "provider_agreement", "validation_status", "validation_details",
                "status", "failure_reason"
         FROM "custom_geo_geocode_cache"
         WHERE (
             COALESCE("status", 'success') = 'success'
             AND "updated_at" >= CURRENT_TIMESTAMP - ($1 * INTERVAL '1 day')
         )
         OR (
             COALESCE("status", 'success') = 'not_found'
             AND "updated_at" >= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 day')
         )
         OR (
             COALESCE("status", 'success') = 'review_required'
             AND "updated_at" >= CURRENT_TIMESTAMP - ($1 * INTERVAL '1 day')
         )`,
        [CACHE_TTL_DAYS, NOT_FOUND_CACHE_TTL_DAYS],
    );

    for (const row of res.rows) {
        setMemoryCache(row.cache_key, {
            country: row.country || '',
            state: row.state,
            city: row.city,
            legalDong: row.legal_dong || '',
            roadAddress: row.road_address || '',
            jibunAddress: row.jibun_address || '',
            buildingName: row.building_name || '',
            provider: row.provider || '',
            providerAgreement: row.provider_agreement,
            validationStatus: row.validation_status || row.status || 'success',
            validationDetails: row.validation_details || null,
            status: row.status || 'success',
            failureReason: row.failure_reason || '',
        }, false);
    }

    return res.rows.length;
}

async function clearAllCache(client) {
    addressCache.clear();
    await client.query('TRUNCATE TABLE "custom_geo_geocode_cache"');
}

async function upsertCache(client, cacheKey, address) {
    await client.query(
        `INSERT INTO "custom_geo_geocode_cache"
            ("cache_key", "country", "state", "city", "legal_dong", "road_address", "jibun_address",
             "building_name", "provider", "provider_agreement", "validation_status", "validation_details",
             "status", "failure_reason", "updated_at")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, CURRENT_TIMESTAMP)
         ON CONFLICT ("cache_key") DO UPDATE
         SET "country" = EXCLUDED."country",
             "state" = EXCLUDED."state",
             "city" = EXCLUDED."city",
             "legal_dong" = EXCLUDED."legal_dong",
             "road_address" = EXCLUDED."road_address",
             "jibun_address" = EXCLUDED."jibun_address",
             "building_name" = EXCLUDED."building_name",
             "provider" = EXCLUDED."provider",
             "provider_agreement" = EXCLUDED."provider_agreement",
             "validation_status" = EXCLUDED."validation_status",
             "validation_details" = EXCLUDED."validation_details",
             "status" = EXCLUDED."status",
             "failure_reason" = EXCLUDED."failure_reason",
             "updated_at" = CURRENT_TIMESTAMP`,
        [
            cacheKey, address.country || '', address.state || '', address.city || '', address.legalDong || '',
            address.roadAddress || '', address.jibunAddress || '', address.buildingName || '', address.provider || '',
            address.providerAgreement, address.validationStatus || address.status || 'success',
            JSON.stringify(address.validationDetails || null), address.status || 'success', address.failureReason || '',
        ],
    );
}

function isNotFoundDiagnostics(diagnostics) {
    const vworldReason = String(diagnostics?.vworld?.reason || '').toUpperCase();
    const naverReason = String(diagnostics?.naver?.reason || '');
    const vworldNotFound = vworldReason === 'NOT_FOUND';
    const naverNotFound = naverReason.includes('결과가 없습니다');
    return vworldNotFound && naverNotFound;
}

function buildStructuredAddress(result) {
    return {
        country: result.summary.country || '',
        state: result.summary.state || '',
        city: result.summary.city || '',
        legalDong: result.summary.legalDong || '',
        roadAddress: result.summary.roadAddress || '',
        jibunAddress: result.summary.jibunAddress || '',
        buildingName: result.summary.buildingName || '',
        provider: result.summary.selectedProvider || '',
        providerAgreement: result.summary.providerAgreement,
        source: 'api',
    };
}

async function validateClusterAddress(cluster, result) {
    const address = buildStructuredAddress(result);
    if (!isWithinSouthKoreaBoundary(cluster.centroidLat, cluster.centroidLon)) {
        return { valid: false, reason: 'outside-south-korea-boundary', checkedPoints: 1 };
    }
    if (!isSouthKoreanAddress(address)) {
        return { valid: false, reason: 'outside-south-korea-or-invalid-state', checkedPoints: 1 };
    }
    if (address.providerAgreement === false) {
        return {
            valid: false,
            reason: 'provider-address-mismatch',
            checkedPoints: 1,
            providers: result.providers,
        };
    }

    const boundaryPoints = getBoundaryValidationPoints(cluster, config.boundaryValidationMinSpanMeters);
    const representativeKey = normalizeAdministrativeKey(address);
    const checked = [];
    for (const point of boundaryPoints) {
        const boundaryResult = await reverseGeocode(point.latitude, point.longitude, {
            naverId: config.naverId,
            naverSecret: config.naverSecret,
            vworldKey: config.vworldKey,
            apiTimeoutMs: config.apiTimeoutMs,
        }, {
            preferBuildingName: false,
            includeRaw: false,
        });
        const boundaryAddress = boundaryResult?.ok ? buildStructuredAddress(boundaryResult) : null;
        checked.push({
            latitude: point.latitude,
            longitude: point.longitude,
            addressKey: boundaryAddress ? normalizeAdministrativeKey(boundaryAddress) : '',
        });
        if (!boundaryAddress || !isSouthKoreanAddress(boundaryAddress)) {
            return { valid: false, reason: 'boundary-point-unresolved', checkedPoints: checked.length + 1, checked };
        }
        if (!isWithinSouthKoreaBoundary(point.latitude, point.longitude)) {
            return { valid: false, reason: 'boundary-point-outside-south-korea', checkedPoints: checked.length + 1, checked };
        }
        if (normalizeAdministrativeKey(boundaryAddress) !== representativeKey) {
            return { valid: false, reason: 'boundary-address-mismatch', checkedPoints: checked.length + 1, checked };
        }
        if (config.delay > 0) await sleep(config.delay);
    }

    return { valid: true, reason: 'validated', checkedPoints: boundaryPoints.length + 1, checked };
}

async function cacheReviewRequired(client, cacheKey, address, validation) {
    const review = {
        ...(address || {}),
        status: 'review_required',
        validationStatus: 'review_required',
        validationDetails: validation,
        failureReason: validation.reason || 'review-required',
    };
    setMemoryCache(cacheKey, review);
    await upsertCache(client, cacheKey, review);
    return { address: null, diagnostics: null, cacheStatus: 'review_required', validation };
}

async function getClusterAddress(client, cluster) {
    const cacheKey = getGeoCacheKeyForCluster(cluster);

    if (addressCache.has(cacheKey)) {
        const cached = addressCache.get(cacheKey);
        if (cached.status === 'not_found') {
            return {
                address: null,
                diagnostics: {
                    vworld: { attempted: false, reason: cached.failureReason || 'cached-not-found', statusCode: 0 },
                    naver: { attempted: false, reason: cached.failureReason || 'cached-not-found', statusCode: 0 },
                },
                cacheStatus: 'not_found',
            };
        }
        if (cached.status === 'review_required') {
            return { address: null, diagnostics: null, cacheStatus: 'review_required', validation: cached.validationDetails };
        }
        return { address: { ...cached, source: 'memory' }, diagnostics: null, cacheStatus: 'success' };
    }

    const result = await reverseGeocode(cluster.centroidLat, cluster.centroidLon, {
        naverId: config.naverId,
        naverSecret: config.naverSecret,
        vworldKey: config.vworldKey,
        apiTimeoutMs: config.apiTimeoutMs,
    }, {
        preferBuildingName: config.appendBuildingName,
        includeRaw: false,
    });

    let address = null;
    if (result?.ok) {
        address = buildStructuredAddress(result);
        const validation = await validateClusterAddress(cluster, result);
        if (!validation.valid) {
            return cacheReviewRequired(client, cacheKey, address, validation);
        }
        address.validationStatus = 'validated';
        address.validationDetails = validation;
    }

    if (!address) {
        const korState = translateLocation(cluster.points[0]?.state);
        const korCity = translateLocation(cluster.points[0]?.city);
        if (korState || korCity) {
            address = {
                country: '대한민국',
                state: korState || cluster.points[0]?.state || '',
                city: korCity || cluster.points[0]?.city || '',
                legalDong: '',
                roadAddress: '',
                jibunAddress: '',
                buildingName: '',
                source: 'fallback',
                provider: 'mapping',
                providerAgreement: null,
                validationStatus: 'mapped-fallback',
                validationDetails: { reason: 'translated-existing-metadata' },
            };
        }
    }
    if (!address) {
        const diagnostics = result?.diagnostics || null;
        if (isNotFoundDiagnostics(diagnostics)) {
            const negativeCache = {
                state: '',
                city: '',
                status: 'not_found',
                validationStatus: 'not_found',
                validationDetails: { reason: 'not-found' },
                failureReason: 'not-found',
            };
            setMemoryCache(cacheKey, negativeCache);
            try {
                await upsertCache(client, cacheKey, negativeCache);
            } catch (e) {}
            return { address: null, diagnostics, cacheStatus: 'not_found' };
        }
        return { address: null, diagnostics, cacheStatus: 'miss' };
    }

    address.status = 'success';
    address.failureReason = '';
    setMemoryCache(cacheKey, address);
    try {
        await upsertCache(client, cacheKey, address);
    } catch (e) {}

    return { address, diagnostics: result?.diagnostics || null, cacheStatus: 'success' };
}

async function listEnabledOverrideRules(client) {
    await client.query(`
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
    await client.query('ALTER TABLE "custom_geo_override_rules" ADD COLUMN IF NOT EXISTS "apply_as_override" BOOLEAN NOT NULL DEFAULT TRUE');
    await client.query('ALTER TABLE "custom_geo_override_rules" ADD COLUMN IF NOT EXISTS "treat_as_single_cluster" BOOLEAN NOT NULL DEFAULT FALSE');

    const res = await client.query(`
        SELECT "id", "name", "rule_type", "geometry", "country", "state", "city", "building", "priority", "enabled", "apply_as_override", "treat_as_single_cluster"
        FROM "custom_geo_override_rules"
        WHERE "enabled" = TRUE
        ORDER BY "priority" ASC, "created_at" DESC
    `);

    return res.rows.map((row) => ({
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
    }));
}

async function updateAssetChunk(client, items) {
    const values = [];
    const placeholders = [];

    items.forEach((item, index) => {
        const base = index * 3;
        placeholders.push(`($${base + 1}::uuid, $${base + 2}, $${base + 3})`);
        values.push(item.assetId, item.state, item.city);
    });

    const query = `
        UPDATE "asset_exif" AS a
        SET
            "country" = '대한민국',
            "state" = v.state,
            "city" = v.city
        FROM (
            VALUES ${placeholders.join(', ')}
        ) AS v(asset_id, state, city)
        WHERE a."assetId" = v.asset_id
    `;

    const result = await client.query(query, values);
    return result.rowCount || 0;
}

async function bulkUpdateAssets(client, items) {
    let totalUpdated = 0;

    for (let i = 0; i < items.length; i += DB_UPDATE_CHUNK_SIZE) {
        const chunk = items.slice(i, i + DB_UPDATE_CHUNK_SIZE);
        totalUpdated += await updateAssetChunk(client, chunk);
    }

    return totalUpdated;
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function createEntityCluster(key, rows, entityField, entity) {
    const representative = selectRepresentativeCoordinate(rows);
    return {
        clusterId: key,
        clusterKey: key,
        geoCacheKey: key,
        centroidLat: representative.latitude,
        centroidLon: representative.longitude,
        assetCount: rows.length,
        uniqueCoordinateCount: new Set(rows.map((row) => `${Number(row.latitude)}:${Number(row.longitude)}`)).size,
        assetIds: rows.map((row) => row.assetId),
        points: rows,
        [entityField]: entity,
    };
}

function partitionRowsByOverride(rows, overrideRules) {
    const { matches, remainingRows } = partitionRowsByRules(rows, overrideRules, findMatchingRule);
    const overrideClusters = matches.map(({ rule, rows: matchedRows }) => {
        const cluster = createEntityCluster(`override:${rule.id}`, matchedRows, 'overrideRule', rule);
        return { ...cluster, overrideAddress: buildRuleAddress(rule), cacheKey: cluster.geoCacheKey };
    });
    return { overrideClusters, remainingRows };
}

function clusterRows(rows, radiusMeters, clusterGroups = []) {
    const groupedMap = new Map();
    const ungrouped = [];

    for (const row of rows) {
        const group = findMatchingGeometryEntity(Number(row.latitude), Number(row.longitude), clusterGroups);
        if (!group) {
            ungrouped.push(row);
            continue;
        }

        const key = `manual-group:${group.id}`;
        if (!groupedMap.has(key)) groupedMap.set(key, { group, rows: [] });
        groupedMap.get(key).rows.push(row);
    }

    const manualClusters = [...groupedMap.entries()].map(([key, { group, rows: matchedRows }]) =>
        createEntityCluster(key, matchedRows, 'manualGroup', group));
    return [...manualClusters, ...clusterRowsByGrid(ungrouped, radiusMeters)];
}

async function listEnabledClusterGroups(client) {
    await client.query(`
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
    await client.query('ALTER TABLE "custom_geo_cluster_groups" ADD COLUMN IF NOT EXISTS "sources" JSONB');

    const res = await client.query(`
        SELECT "id", "name", "geometry", "sources", "enabled"
        FROM "custom_geo_cluster_groups"
        WHERE "enabled" = TRUE
        ORDER BY "created_at" DESC
    `);

    return res.rows.map((row) => ({
        id: row.id,
        name: row.name,
        geometry: row.geometry,
        sources: Array.isArray(row.sources) ? row.sources : [],
        enabled: row.enabled,
    }));
}

async function main(forceUpdate = false) {
    if (isRunning) {
        console.log(`[${nowKst()}] ⏳ 이미 작업이 진행 중입니다. 스킵합니다.`);
        return;
    }

    isRunning = true;
    activeRunId = randomUUID();
    const client = new Client(config.db);
    const logClient = new Client(config.db);

    let connected = false;
    let retryCount = 0;

    while (!connected && retryCount < config.dbRetryLimit) {
        try {
            await client.connect();
            connected = true;
            if (retryCount > 0) {
                console.log(`[${nowKst()}] ✅ DB 연결 성공 (재시도 ${retryCount}회차)`);
            }
        } catch (err) {
            retryCount++;
            if (retryCount >= config.dbRetryLimit) {
                console.error(`[${nowKst()}] ❌ DB 연결 실패 (최대 재시도 횟수 초과):`, err.message);
                isRunning = false;
                return;
            }
            const delay = config.dbRetryDelayMs * Math.pow(2, retryCount - 1);
            console.warn(`[${nowKst()}] ⚠️ DB 연결 실패 (${err.message}). ${delay / 1000}초 후 재시도합니다... (${retryCount}/${config.dbRetryLimit})`);
            await sleep(delay);
        }
    }

    try {
        await ensureWorkerMonitorTables(client);
        await logClient.connect();
        activeLogClient = logClient;
        await startWorkerRun(client, {
            id: activeRunId,
            forceUpdate,
            config: getWorkerRuntimeConfig(),
        });

        await ensureCacheTable(client);

        if (shouldClearCache || clearCacheOnly) {
            console.log(`[${nowKst()}] 🧹 캐시 삭제 시작`);
            await clearAllCache(client);
            console.log(`[${nowKst()}] ✅ 메모리/DB 캐시 삭제 완료`);
            if (clearCacheOnly) {
                await finishWorkerRun(client, {
                    id: activeRunId,
                    status: 'completed',
                    summary: { mode: 'clear-cache-only' },
                });
                return;
            }
        }

        const warmedCount = await warmUpCache(client);
        console.log(`[${nowKst()}] 🔥 캐시 워밍업 완료: ${warmedCount}건 적재`);

        const allRules = await listEnabledOverrideRules(client);
        const overrideRules = allRules.filter((rule) => rule.applyAsOverride !== false);
        const ruleBasedClusterGroups = allRules.filter((rule) => rule.treatAsSingleCluster === true);
        const legacyClusterGroups = await listEnabledClusterGroups(client);
        const clusterGroups = [...ruleBasedClusterGroups, ...legacyClusterGroups];
        console.log(`[${nowKst()}] 🗺️ 활성 override rule 로드: ${overrideRules.length}개`);
        console.log(`[${nowKst()}] 🧩 활성 single-cluster rule/group 로드: ${clusterGroups.length}개`);

        let queryCondition = `WHERE "latitude" BETWEEN ${SOUTH_KOREA_BOUNDS.south} AND ${SOUTH_KOREA_BOUNDS.north}`;
        queryCondition += ` AND "longitude" BETWEEN ${SOUTH_KOREA_BOUNDS.west} AND ${SOUTH_KOREA_BOUNDS.east}`;
        queryCondition += ` AND (COALESCE("country", '') IN ('', 'South Korea', '대한민국', 'Korea'))`;

        if (!forceUpdate) {
            queryCondition += ` AND ("city" IS NULL OR "city" !~ '[가-힣]')`;
        }

        const query = `
            SELECT "assetId", "latitude", "longitude", "country", "city", "state"
            FROM "asset_exif"
            ${queryCondition};
        `;

        const res = await client.query(query);
        console.log(`[${nowKst()}] 📦 대상 사진 조회 완료: ${res.rows.length}건`);

        if (res.rows.length === 0) {
            console.log(`[${nowKst()}] 🔍 업데이트할 항목이 없습니다.`);
            await finishWorkerRun(client, {
                id: activeRunId,
                status: 'completed',
                summary: { targetPhotos: 0, totalUpdated: 0 },
            });
            return;
        }

        console.log(`[${nowKst()}] 🧩 클러스터링 시작 (반경 ${config.clusterRadiusMeters}m)`);
        const { overrideClusters, remainingRows } = partitionRowsByOverride(res.rows, overrideRules);
        const clusters = clusterRows(remainingRows, config.clusterRadiusMeters, clusterGroups);
        const fastTrackClusters = [];
        const negativeCacheClusters = [];
        const reviewRequiredClusters = [];
        const apiTrackClusters = [];
        const overrideCacheFillClusters = [];
        let overrideCacheWarmHits = 0;
        let overrideCacheWarmMisses = 0;
        let overrideCacheWarmNotFound = 0;

        for (const cluster of overrideClusters) {
            const cached = addressCache.get(cluster.cacheKey);
            if (!cached) {
                overrideCacheFillClusters.push(cluster);
                overrideCacheWarmMisses++;
            } else if (cached.status === 'not_found') {
                overrideCacheWarmNotFound++;
            } else {
                overrideCacheWarmHits++;
            }
        }

        for (const cluster of clusters) {
            const cacheKey = getGeoCacheKeyForCluster(cluster);
            const cached = addressCache.get(cacheKey);

            if (!cached) {
                apiTrackClusters.push(cluster);
            } else if (cached.status === 'not_found') {
                negativeCacheClusters.push(cluster);
            } else if (cached.status === 'review_required') {
                reviewRequiredClusters.push(cluster);
            } else {
                fastTrackClusters.push(cluster);
            }
        }

        const overridePhotos = overrideClusters.reduce((sum, cluster) => sum + cluster.assetCount, 0);
        const fastTrackPhotos = fastTrackClusters.reduce((sum, cluster) => sum + cluster.assetCount, 0);
        const negativeCachePhotos = negativeCacheClusters.reduce((sum, cluster) => sum + cluster.assetCount, 0);
        let reviewRequiredPhotos = reviewRequiredClusters.reduce((sum, cluster) => sum + cluster.assetCount, 0);
        const apiTrackPhotos = apiTrackClusters.reduce((sum, cluster) => sum + cluster.assetCount, 0);

        console.log(`[${nowKst()}] 🧭 대상 분류 완료 (적용 우선순위: polygon > cache > api)`);
        console.log(` ├─ 전체 사진: ${res.rows.length}건`);
        console.log(` ├─ 전체 클러스터: ${clusters.length + overrideClusters.length}개`);
        console.log(` ├─ Polygon 적용 대상: ${overrideClusters.length}개 클러스터 / ${overridePhotos}장`);
        console.log(` │  └─ Polygon 대상 캐시 상태: hit ${overrideCacheWarmHits} / miss ${overrideCacheWarmMisses} / not_found ${overrideCacheWarmNotFound}`);
        console.log(` ├─ Cache 즉시 반영 대상: ${fastTrackClusters.length}개 클러스터 / ${fastTrackPhotos}장`);
        console.log(` ├─ Cache not_found 보류: ${negativeCacheClusters.length}개 클러스터 / ${negativeCachePhotos}장`);
        console.log(` ├─ 경계/국가 검토 대기: ${reviewRequiredClusters.length}개 클러스터 / ${reviewRequiredPhotos}장`);
        console.log(` └─ Cache miss(API 조회 필요): ${apiTrackClusters.length}개 클러스터 / ${apiTrackPhotos}장`);

        let totalUpdated = 0;
        let overrideUpdated = 0;
        let fastTrackUpdated = 0;
        let apiTrackUpdated = 0;
        let negativeCacheSkippedClusters = negativeCacheClusters.length;
        let negativeCacheSkippedPhotos = negativeCachePhotos;
        let apiCallCount = 0;
        let apiAttemptedClusters = 0;
        let apiFailedClusters = 0;
        let apiReviewRequiredClusters = 0;
        let apiFailureLogCount = 0;
        let fastPrepared = 0;
        let apiProcessedClusters = 0;
        let apiProcessedPhotos = 0;
        const totalPhotos = apiTrackPhotos;
        let overrideCacheFilledSuccess = 0;
        let overrideCacheFilledNotFound = 0;
        let overrideCacheFilledMiss = 0;

        if (overrideCacheFillClusters.length > 0) {
            console.log(`[${nowKst()}] 🧱 Polygon 대상 캐시 보강 시작: ${overrideCacheFillClusters.length}개 클러스터`);
            for (const cluster of overrideCacheFillClusters) {
                const { address, cacheStatus } = await getClusterAddress(client, cluster);
                if (address) {
                    overrideCacheFilledSuccess++;
                } else if (cacheStatus === 'not_found') {
                    overrideCacheFilledNotFound++;
                } else {
                    overrideCacheFilledMiss++;
                }
                if (address?.source === 'api') {
                    await sleep(config.delay);
                }
            }
            console.log(`[${nowKst()}] ✅ Polygon 대상 캐시 보강 완료: success ${overrideCacheFilledSuccess}, not_found ${overrideCacheFilledNotFound}, miss ${overrideCacheFilledMiss}`);
        }

        if (overrideClusters.length > 0) {
            console.log(`[${nowKst()}] 🧷 Polygon Phase 시작: 수동 rule 적용 (${overrideClusters.length}개 / ${overridePhotos}장)`);
            const overrideItems = [];
            for (const cluster of overrideClusters) {
                const overrideAddress = cluster.overrideRule.treatAsSingleCluster === true
                    ? await buildClusterRuleAddress(cluster.overrideRule, config, {
                        fallbackState: cluster.points[0]?.state,
                        fallbackCity: cluster.points[0]?.city,
                    })
                    : cluster.overrideAddress;
                for (const assetId of cluster.assetIds) {
                    overrideItems.push({ assetId, state: overrideAddress.state, city: overrideAddress.city });
                }

                if (overrideAddress.source === 'override-single-cluster-vworld') {
                    await sleep(config.delay);
                }
            }
            overrideUpdated = await bulkUpdateAssets(client, overrideItems);
            totalUpdated += overrideUpdated;
            console.log(`[${nowKst()}] ✅ Polygon Phase 완료: ${overrideUpdated}건 반영`);
        }

        console.log(`[${nowKst()}] ⚡ Cache Phase 시작: 캐시 적중 클러스터 반영 (${fastTrackClusters.length}개 / ${fastTrackPhotos}장)`);

        for (let i = 0; i < fastTrackClusters.length; i += FAST_TRACK_CHUNK_SIZE) {
            const chunk = fastTrackClusters.slice(i, i + FAST_TRACK_CHUNK_SIZE);
            const updateItems = [];

            for (const cluster of chunk) {
                const cached = addressCache.get(getGeoCacheKeyForCluster(cluster));
                if (!cached) continue;
                for (const assetId of cluster.assetIds) {
                    updateItems.push({ assetId, state: cached.state, city: cached.city });
                }
                fastPrepared += cluster.assetCount;
            }

            if (updateItems.length > 0) {
                const updated = await bulkUpdateAssets(client, updateItems);
                fastTrackUpdated += updated;
                totalUpdated += updated;
            }

            if (fastPrepared % FAST_TRACK_LOG_INTERVAL === 0 || fastPrepared === fastTrackPhotos) {
                const ratio = fastTrackPhotos ? ((fastPrepared / fastTrackPhotos) * 100).toFixed(1) : '100.0';
                console.log(`[${nowKst()}] ⚡ Cache Phase 진행: ${fastPrepared}/${fastTrackPhotos}장 (${ratio}%) 처리, DB 반영 ${fastTrackUpdated}건`);
            }
        }

        console.log(`[${nowKst()}] ✅ Cache Phase 완료: ${fastTrackUpdated}건 반영`);

        if (apiTrackClusters.length > 0) {
            console.log(`[${nowKst()}] 🌐 API Phase 시작: 캐시 미스 클러스터 조회/반영 (${apiTrackClusters.length}개 / ${apiTrackPhotos}장)`);

            for (const cluster of apiTrackClusters) {
                apiProcessedClusters++;
                apiProcessedPhotos += cluster.assetCount;

                const { address, diagnostics, cacheStatus } = await getClusterAddress(client, cluster);
                const attempted = Boolean(diagnostics?.vworld?.attempted || diagnostics?.naver?.attempted);
                if (attempted) apiAttemptedClusters++;
                if (address?.source === 'api') apiCallCount++;

                if (address) {
                    const updateItems = cluster.assetIds.map((assetId) => ({
                        assetId,
                        state: address.state,
                        city: address.city,
                    }));
                    const updated = await bulkUpdateAssets(client, updateItems);
                    apiTrackUpdated += updated;
                    totalUpdated += updated;
                } else if (cacheStatus === 'review_required') {
                    apiReviewRequiredClusters++;
                    reviewRequiredPhotos += cluster.assetCount;
                } else {
                    apiFailedClusters++;
                    if (apiFailureLogCount < API_FAILURE_LOG_LIMIT) {
                        apiFailureLogCount++;
                        console.warn(`[${nowKst()}] ⚠️ API Phase 실패 샘플 ${apiFailureLogCount}/${API_FAILURE_LOG_LIMIT}: clusterKey=${cluster.clusterKey}, vworld=${diagnostics?.vworld?.reason || 'none'}${diagnostics?.vworld?.statusCode ? `(${diagnostics.vworld.statusCode})` : ''}, naver=${diagnostics?.naver?.reason || 'none'}${diagnostics?.naver?.statusCode ? `(${diagnostics.naver.statusCode})` : ''}`);
                    }
                }

                if (apiProcessedClusters <= 3 || apiProcessedClusters % API_TRACK_LOG_INTERVAL === 0 || apiProcessedClusters === apiTrackClusters.length) {
                    const clusterRatio = apiTrackClusters.length ? ((apiProcessedClusters / apiTrackClusters.length) * 100).toFixed(1) : '100.0';
                    const photoRatio = totalPhotos ? ((apiProcessedPhotos / totalPhotos) * 100).toFixed(1) : '100.0';
                    console.log(`[${nowKst()}] 🌐 API Phase 진행: 클러스터 ${apiProcessedClusters}/${apiTrackClusters.length} (${clusterRatio}%), 사진 ${apiProcessedPhotos}/${totalPhotos} (${photoRatio}%), API 시도 ${apiAttemptedClusters}, API 성공 ${apiCallCount}, DB 반영 ${apiTrackUpdated}, 검토 대기 ${apiReviewRequiredClusters}, 실패 ${apiFailedClusters}`);
                }

                if (address?.source === 'api') {
                    await sleep(config.delay);
                }
            }

            console.log(`[${nowKst()}] ✅ API Phase 완료: ${apiTrackUpdated}건 반영`);
        }
        console.log(`[${nowKst()}] 🎉 작업 완료 상세 리포트`);
        console.log(` ┌─ 캐시 워밍업 적재: ${warmedCount}건`);
        console.log(` ├─ 총 클러스터 수: ${clusters.length + overrideClusters.length}개`);
        console.log(` ├─ Polygon 적용 클러스터: ${overrideClusters.length}개`);
        console.log(` ├─ Polygon 대상 캐시 hit/miss/not_found: ${overrideCacheWarmHits}/${overrideCacheWarmMisses}/${overrideCacheWarmNotFound}`);
        console.log(` ├─ Polygon 대상 캐시 보강 success/not_found/miss: ${overrideCacheFilledSuccess}/${overrideCacheFilledNotFound}/${overrideCacheFilledMiss}`);
        console.log(` ├─ Cache 즉시 반영 클러스터: ${fastTrackClusters.length}개`);
        console.log(` ├─ Cache not_found 보류 클러스터: ${negativeCacheSkippedClusters}개`);
        console.log(` ├─ 경계/국가 검토 대기 클러스터: ${reviewRequiredClusters.length + apiReviewRequiredClusters}개`);
        console.log(` ├─ 경계/국가 검토 대기 사진: ${reviewRequiredPhotos}건`);
        console.log(` ├─ API 조회 대상 클러스터: ${apiTrackClusters.length}개`);
        console.log(` ├─ Polygon 반영: ${overrideUpdated}건`);
        console.log(` ├─ Cache 반영: ${fastTrackUpdated}건`);
        console.log(` ├─ Cache not_found 보류 사진: ${negativeCacheSkippedPhotos}건`);
        console.log(` ├─ API 반영: ${apiTrackUpdated}건`);
        console.log(` ├─ API 시도 클러스터: ${apiAttemptedClusters}개`);
        console.log(` ├─ 실제 VWorld/Naver 성공 클러스터: ${apiCallCount}개`);
        console.log(` ├─ API 실패 클러스터: ${apiFailedClusters}개`);
        console.log(` └─ 총 DB 반영: ${totalUpdated}건`);
        if (totalUpdated === 0 && negativeCacheSkippedPhotos > 0) {
            console.log(`[${nowKst()}] ℹ️ DB 반영 0건은 정상일 수 있습니다. 이번 배치는 cache not_found 보류 사진(${negativeCacheSkippedPhotos}건)만 포함되어 최종 반영이 생략되었습니다.`);
        }
        await finishWorkerRun(client, {
            id: activeRunId,
            status: 'completed',
            summary: {
                targetPhotos: res.rows.length,
                totalClusters: clusters.length + overrideClusters.length,
                overrideClusters: overrideClusters.length,
                fastTrackClusters: fastTrackClusters.length,
                negativeCacheClusters: negativeCacheSkippedClusters,
                reviewRequiredClusters: reviewRequiredClusters.length + apiReviewRequiredClusters,
                reviewRequiredPhotos,
                apiTrackClusters: apiTrackClusters.length,
                overrideUpdated,
                fastTrackUpdated,
                apiTrackUpdated,
                apiAttemptedClusters,
                apiCallCount,
                apiFailedClusters,
                totalUpdated,
            },
        });
    } catch (err) {
        console.error('❌ [DB 에러]', err.message);
        if (activeLogClient && activeRunId) {
            try {
                await finishWorkerRun(client, {
                    id: activeRunId,
                    status: 'failed',
                    error: err.message,
                });
            } catch (e) {}
        }
    } finally {
        activeLogClient = null;
        await Promise.allSettled([...pendingLogWrites]);
        try {
            await logClient.end();
        } catch (e) {}
        try {
            await client.end();
        } catch (e) {}
        activeRunId = null;
        isRunning = false;
    }
}

if (isForceMode || shouldClearCache || clearCacheOnly) {
    main(isForceMode).then(() => process.exit(0));
} else {
    main(false);
    setInterval(() => main(false), config.interval);
}
