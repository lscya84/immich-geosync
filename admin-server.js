const path = require('path');
const express = require('express');
const {
  ensureAdminTables,
  listRules,
  createRule,
  updateRule,
  deleteRule,
  previewRule,
  applyRule,
  listClusters,
} = require('./lib/admin-db');

const app = express();
const port = parseInt(process.env.ADMIN_PORT || '3030', 10);

app.use(express.json({ limit: '1mb' }));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

function validateRulePayload(body) {
  if (!body || typeof body !== 'object') return '요청 본문이 필요합니다.';
  if (!body.name || typeof body.name !== 'string') return 'name은 필수입니다.';
  if (!['point', 'polygon'].includes(body.ruleType)) return 'ruleType은 point 또는 polygon이어야 합니다.';
  if (!body.geometry || typeof body.geometry !== 'object') return 'geometry는 필수입니다.';
  return null;
}

app.get('/healthz', (req, res) => {
  res.json({ ok: true });
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

app.get('/api/clusters', async (req, res) => {
  try {
    res.json({ clusters: await listClusters() });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
