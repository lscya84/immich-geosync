const fs = require('fs');

const envPath = (process.env.ADMIN_ENV_PATH || '/app/.env').trim() || '/app/.env';

const settingDefinitions = [
  { key: 'INTERVAL_HOURS', label: '워커 작동 주기(시간)', type: 'number', secret: false },
  { key: 'STEP_DELAY_MS', label: 'API 호출 지연(ms)', type: 'number', secret: false },
  { key: 'CLUSTER_RADIUS_METERS', label: '클러스터 반경(m)', type: 'number', secret: false },
  { key: 'APPEND_BUILDING_NAME', label: '건물명 자동 추가', type: 'boolean', secret: false },
  { key: 'API_TIMEOUT_MS', label: 'API 타임아웃(ms)', type: 'number', secret: false },
  { key: 'NAVER_API_TIMEOUT_MS', label: 'Naver API 타임아웃(ms)', type: 'number', secret: false },
  { key: 'VWORLD_API_KEY', label: 'VWorld API Key', type: 'text', secret: true },
  { key: 'NAVER_CLIENT_ID', label: 'Naver Client ID', type: 'text', secret: true },
  { key: 'NAVER_CLIENT_SECRET', label: 'Naver Client Secret', type: 'text', secret: true },
];

const settingMap = new Map(settingDefinitions.map((item) => [item.key, item]));

function parseEnv(content) {
  const values = {};
  const lines = String(content || '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1);
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function serializeEnvValue(value) {
  const text = String(value ?? '');
  if (!text || /[\s#"'\\]/.test(text)) return JSON.stringify(text);
  return text;
}

function maskSecret(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= 8) return '********';
  return `${text.slice(0, 4)}****${text.slice(-4)}`;
}

function normalizeValue(definition, value) {
  if (definition.type === 'boolean') {
    return /^(1|true|yes|on)$/i.test(String(value || '').trim()) ? 'true' : 'false';
  }
  if (definition.type === 'number') {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error(`${definition.key} 값이 올바르지 않습니다.`);
    return String(Math.trunc(number));
  }
  return String(value ?? '').trim();
}

function readEnvFile() {
  const content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  return { content, values: parseEnv(content) };
}

function listSettings() {
  const { values } = readEnvFile();
  return {
    path: envPath,
    settings: settingDefinitions.map((definition) => {
      const value = values[definition.key] ?? '';
      return {
        ...definition,
        value: definition.secret ? '' : value,
        displayValue: definition.secret ? maskSecret(value) : value,
        isSet: value !== '',
      };
    }),
  };
}

function updateSettings(updates = {}) {
  const { content } = readEnvFile();
  const lines = content ? content.split(/\r?\n/) : [];
  const consumed = new Set();
  const normalizedUpdates = {};

  for (const [key, value] of Object.entries(updates || {})) {
    const definition = settingMap.get(key);
    if (!definition) continue;
    if (definition.secret && String(value || '').trim() === '') continue;
    normalizedUpdates[key] = normalizeValue(definition, value);
  }

  const nextLines = lines.map((line) => {
    const index = line.indexOf('=');
    if (index <= 0 || line.trim().startsWith('#')) return line;
    const key = line.slice(0, index).trim();
    if (!Object.prototype.hasOwnProperty.call(normalizedUpdates, key)) return line;
    consumed.add(key);
    return `${key}=${serializeEnvValue(normalizedUpdates[key])}`;
  });

  for (const [key, value] of Object.entries(normalizedUpdates)) {
    if (!consumed.has(key)) nextLines.push(`${key}=${serializeEnvValue(value)}`);
  }

  fs.writeFileSync(envPath, `${nextLines.join('\n').replace(/\n+$/u, '')}\n`, 'utf8');
  return listSettings();
}

module.exports = {
  listSettings,
  updateSettings,
  envPath,
};
