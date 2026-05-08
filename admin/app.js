const map = L.map('map').setView([36.5, 127.8], 7);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

const clusterLayer = L.layerGroup().addTo(map);
const ruleLayer = L.layerGroup().addTo(map);
const draftLayer = L.layerGroup().addTo(map);

let drawMode = null;
let draftPoints = [];
let draftShape = null;

function setDrawMode(mode) {
  drawMode = mode;
  draftPoints = [];
  renderDraft();
}

function renderDraft() {
  draftLayer.clearLayers();
  if (draftShape) {
    draftLayer.removeLayer(draftShape);
    draftShape = null;
  }

  if (drawMode === 'point' && draftPoints.length === 1) {
    draftShape = L.circleMarker(draftPoints[0], { radius: 8, color: 'red' }).addTo(draftLayer);
  }

  if (drawMode === 'polygon' && draftPoints.length > 0) {
    draftShape = L.polygon(draftPoints, { color: 'red' }).addTo(draftLayer);
  }
}

function getDraftGeometry() {
  if (drawMode === 'point' && draftPoints.length === 1) {
    const p = draftPoints[0];
    return { type: 'Point', coordinates: [p.lng, p.lat], radiusMeters: 20 };
  }

  if (drawMode === 'polygon' && draftPoints.length >= 3) {
    const coordinates = draftPoints.map((p) => [p.lng, p.lat]);
    coordinates.push([draftPoints[0].lng, draftPoints[0].lat]);
    return { type: 'Polygon', coordinates };
  }

  return null;
}

function setPreviewOutput(value) {
  document.getElementById('preview-output').textContent = value;
}

function renderRules(rules) {
  const list = document.getElementById('rule-list');
  list.innerHTML = '';
  ruleLayer.clearLayers();

  rules.forEach((rule) => {
    const item = document.createElement('li');
    item.className = 'rule-item';
    item.innerHTML = `
      <strong>${rule.name}</strong>
      <div>type: ${rule.ruleType}</div>
      <div>priority: ${rule.priority}</div>
      <div>${rule.state || ''} ${rule.city || ''} ${rule.building || ''}</div>
      <div class="rule-actions">
        <button type="button" data-action="preview">preview</button>
        <button type="button" data-action="apply">apply</button>
        <button type="button" data-action="delete">delete</button>
      </div>
    `;
    list.appendChild(item);

    item.querySelector('[data-action="preview"]').addEventListener('click', async () => {
      const result = await fetchJson(`/api/rules/${rule.id}/preview`, { method: 'POST' });
      setPreviewOutput(JSON.stringify(result, null, 2));
    });

    item.querySelector('[data-action="apply"]').addEventListener('click', async () => {
      if (!confirm(`rule \"${rule.name}\" 를 즉시 적용할까요?`)) return;
      const result = await fetchJson(`/api/rules/${rule.id}/apply`, { method: 'POST' });
      setPreviewOutput(JSON.stringify(result, null, 2));
      await loadClusters();
    });

    item.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm(`rule \"${rule.name}\" 를 삭제할까요?`)) return;
      const res = await fetch(`/api/rules/${rule.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '삭제 실패');
      }
      setPreviewOutput(`삭제 완료: ${rule.name}`);
      await loadRules();
    });

    if (rule.geometry?.type === 'Point') {
      const [lng, lat] = rule.geometry.coordinates;
      L.circle([lat, lng], { radius: rule.geometry.radiusMeters || 20, color: '#2563eb' })
        .bindPopup(rule.name)
        .addTo(ruleLayer);
    }

    if (rule.geometry?.type === 'Polygon') {
      const latlngs = rule.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      L.polygon(latlngs, { color: '#2563eb' }).bindPopup(rule.name).addTo(ruleLayer);
    }
  });
}

function renderClusters(clusters) {
  clusterLayer.clearLayers();
  clusters.forEach((cluster) => {
    L.circleMarker([cluster.latitude, cluster.longitude], {
      radius: Math.max(4, Math.min(14, Math.log2(cluster.assetCount + 1) * 2)),
      color: '#16a34a',
      fillOpacity: 0.5,
    })
      .bindPopup(`사진 ${cluster.assetCount}장<br>${cluster.state || ''} ${cluster.city || ''}`)
      .addTo(clusterLayer);
  });
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '요청 실패');
  return data;
}

async function loadRules() {
  const data = await fetchJson('/api/rules');
  renderRules(data.rules);
}

async function loadClusters() {
  const data = await fetchJson('/api/clusters');
  renderClusters(data.clusters);
}

map.on('click', (event) => {
  if (!drawMode) return;
  if (drawMode === 'point') draftPoints = [event.latlng];
  if (drawMode === 'polygon') draftPoints.push(event.latlng);
  renderDraft();
});

document.getElementById('start-point').addEventListener('click', () => setDrawMode('point'));
document.getElementById('start-polygon').addEventListener('click', () => setDrawMode('polygon'));
document.getElementById('clear-shape').addEventListener('click', () => {
  draftPoints = [];
  renderDraft();
});
document.getElementById('finish-shape').addEventListener('click', () => {
  const geometry = getDraftGeometry();
  if (!geometry) {
    alert('완성된 도형이 없습니다.');
    return;
  }
  alert('도형이 준비되었습니다. 왼쪽 폼에서 저장하세요.');
});
document.getElementById('refresh-rules').addEventListener('click', loadRules);
document.getElementById('refresh-clusters').addEventListener('click', loadClusters);

document.getElementById('rule-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const geometry = getDraftGeometry();
  if (!geometry) {
    alert('먼저 지도에서 point 또는 polygon을 그려주세요.');
    return;
  }

  const formData = new FormData(event.target);
  const payload = {
    name: formData.get('name'),
    ruleType: formData.get('ruleType'),
    geometry,
    country: formData.get('country'),
    state: formData.get('state'),
    city: formData.get('city'),
    building: formData.get('building'),
    priority: Number(formData.get('priority') || 100),
    enabled: formData.get('enabled') === 'on',
  };

  await fetchJson('/api/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  event.target.reset();
  event.target.country.value = '대한민국';
  event.target.priority.value = 100;
  event.target.enabled.checked = true;
  draftPoints = [];
  renderDraft();
  await loadRules();
  alert('rule이 저장되었습니다.');
});

Promise.all([loadRules(), loadClusters()]).catch((error) => {
  console.error(error);
  alert(error.message);
});
