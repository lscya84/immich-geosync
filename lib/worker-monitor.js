async function ensureWorkerMonitorTables(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS "custom_geo_worker_runs" (
      "id" UUID PRIMARY KEY,
      "status" VARCHAR NOT NULL,
      "started_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "finished_at" TIMESTAMP,
      "force_update" BOOLEAN NOT NULL DEFAULT FALSE,
      "summary" JSONB,
      "error" TEXT
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS "custom_geo_worker_logs" (
      "id" BIGSERIAL PRIMARY KEY,
      "run_id" UUID,
      "level" VARCHAR NOT NULL,
      "message" TEXT NOT NULL,
      "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS "custom_geo_worker_state" (
      "id" INTEGER PRIMARY KEY DEFAULT 1,
      "status" VARCHAR NOT NULL DEFAULT 'unknown',
      "last_run_id" UUID,
      "interval_hours" INTEGER,
      "append_building_name" BOOLEAN,
      "config" JSONB,
      "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "custom_geo_worker_state_singleton" CHECK ("id" = 1)
    );
  `);
}

async function startWorkerRun(db, { id, forceUpdate, config }) {
  await db.query(
    `INSERT INTO "custom_geo_worker_runs" ("id", "status", "force_update")
     VALUES ($1, 'running', $2)`,
    [id, forceUpdate === true],
  );
  await db.query(
    `INSERT INTO "custom_geo_worker_state"
       ("id", "status", "last_run_id", "interval_hours", "append_building_name", "config", "updated_at")
     VALUES (1, 'running', $1, $2, $3, $4::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT ("id") DO UPDATE
     SET "status" = EXCLUDED."status",
         "last_run_id" = EXCLUDED."last_run_id",
         "interval_hours" = EXCLUDED."interval_hours",
         "append_building_name" = EXCLUDED."append_building_name",
         "config" = EXCLUDED."config",
         "updated_at" = CURRENT_TIMESTAMP`,
    [
      id,
      config.intervalHours,
      config.appendBuildingName,
      JSON.stringify(config),
    ],
  );
}

async function finishWorkerRun(db, { id, status, summary = null, error = '' }) {
  await db.query(
    `UPDATE "custom_geo_worker_runs"
     SET "status" = $2,
         "finished_at" = CURRENT_TIMESTAMP,
         "summary" = $3::jsonb,
         "error" = $4
     WHERE "id" = $1`,
    [id, status, summary ? JSON.stringify(summary) : null, error || ''],
  );
  await db.query(
    `UPDATE "custom_geo_worker_state"
     SET "status" = $2,
         "updated_at" = CURRENT_TIMESTAMP
     WHERE "id" = 1 AND "last_run_id" = $1`,
    [id, status],
  );
}

async function appendWorkerLog(db, { runId = null, level = 'info', message }) {
  const value = String(message || '').trim();
  if (!value) return;
  await db.query(
    `INSERT INTO "custom_geo_worker_logs" ("run_id", "level", "message")
     VALUES ($1, $2, $3)`,
    [runId || null, level, value],
  );
}

function mapRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    forceUpdate: row.force_update,
    summary: row.summary || null,
    error: row.error || '',
  };
}

async function getWorkerSnapshot(db, { logLimit = 120 } = {}) {
  await ensureWorkerMonitorTables(db);
  const [stateRes, runRes, logRes] = await Promise.all([
    db.query('SELECT * FROM "custom_geo_worker_state" WHERE "id" = 1'),
    db.query(`
      SELECT *
      FROM "custom_geo_worker_runs"
      ORDER BY "started_at" DESC
      LIMIT 10
    `),
    db.query(`
      SELECT "id", "run_id", "level", "message", "created_at"
      FROM "custom_geo_worker_logs"
      ORDER BY "id" DESC
      LIMIT $1
    `, [Math.max(1, Math.min(500, Number(logLimit) || 120))]),
  ]);

  const state = stateRes.rows[0] || null;
  return {
    state: state ? {
      status: state.status,
      lastRunId: state.last_run_id,
      intervalHours: state.interval_hours,
      appendBuildingName: state.append_building_name,
      config: state.config || {},
      updatedAt: state.updated_at,
    } : {
      status: 'unknown',
      lastRunId: null,
      intervalHours: null,
      appendBuildingName: null,
      config: {},
      updatedAt: null,
    },
    runs: runRes.rows.map(mapRun),
    logs: logRes.rows.reverse().map((row) => ({
      id: row.id,
      runId: row.run_id,
      level: row.level,
      message: row.message,
      createdAt: row.created_at,
    })),
  };
}

module.exports = {
  ensureWorkerMonitorTables,
  startWorkerRun,
  finishWorkerRun,
  appendWorkerLog,
  getWorkerSnapshot,
};
