require('dotenv').config({ path: '/app/.env', quiet: true });

function getDbConfig() {
  return {
    user: (process.env.DB_USERNAME || 'postgres').trim(),
    password: (process.env.DB_PASSWORD || '').trim(),
    host: (process.env.DB_HOSTNAME || 'immich_postgres').trim(),
    database: (process.env.DB_DATABASE_NAME || 'immich').trim(),
    port: parseInt(process.env.DB_PORT || '5432', 10),
  };
}

module.exports = { getDbConfig };
