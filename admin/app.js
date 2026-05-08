const map = L.map('map').setView([36.5, 127.8], 7);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

const clusterLayer = L.layerGroup().addTo(map);
const ruleLayer = L.layerGroup().addTo(map);
const draftLayer = L.layerGroup().addTo(map);
const editLayer = L.layerGroup().addTo(map);

const ruleForm = document.getElementById('rule-form');
const saveRuleButton = document.getElementById('save-rule-button');
const saveApplyRuleButton = document.getElementById('save-apply-rule-button');
const saveEditButton = document.getElementById('save-edit');
const cancelEditButton = document.getElementById('cancel-edit');
const mobilePanelToggle = document.getElementById('mobile-panel-toggle');
const mobilePanelBackdrop = document.getElementById('mobile-panel-backdrop');
const toolbarMoreToggle = document.getElementById('toolbar-more-toggle');
const toolbarSecondary = document.getElementById('toolbar-secondary');

let drawMode = null;
let draftPoints = [];
let draftShape = null;
let currentRules = [];
let editingRuleId = null;
let editingPolygon = null;
let editingHandles = [];
let editingMidpoints = [];
let editingRuleSnapshot = null;

function isMobileLayout() {
  return window.matchMedia('(max-width: 900px)').matches;
}

function setMobilePanelOpen(open) {
  document.body.classList.toggle('mobile-panel-open', open);
  mobilePanelToggle.textContent = open ? '패널 닫기' : '패널 열기';
  mobilePanelToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function setToolbarSecondaryOpen(open) {
  toolbarSecondary.classList.toggle('is-open', open);
  toolbarMoreToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  toolbarMoreToggle.textContent = open ? '닫기' : '더보기';
}

function toggleSection(sectionName) {
  const section = document.querySelector(`.panel-section[data-section="${sectionName}"]`);
  if (!section) return;
  const isOpen = !section.classList.contains('is-open');
  section.classList.toggle('is-open', isOpen);
  const button = section.querySelector('.panel-section-toggle');
  if (button) button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function resetDraft() {
  draftPoints = [];
  renderDraft();
}

function setDrawMode(mode) {
  drawMode = mode;
  resetDraft();
  cancelEditing();
  if (isMobileLayout()) setMobilePanelOpen(false);
}

function renderDraft() {
  draftLayer.clearLayers();
  draftShape = null;

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

function getVertexIcon() {
  return L.divIcon({
    className: '',
    html: '<div class="vertex-handle"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function getMidpointIcon() {
  return L.divIcon({
    className: '',
    html: '<div class="vertex-handle midpoint-handle"></div>',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function setEditingButtons(enabled) {
  saveEditButton.disabled = !enabled;
  cancelEditButton.disabled = !enabled;
}

function getRuleById(ruleId) {
  return currentRules.find((rule) => rule.id === ruleId) || null;
}

function clearEditingArtifacts() {
  editLayer.clearLayers();
  editingPolygon = null;
  editingHandles = [];
  editingMidpoints = [];
}

function resetRuleForm() {
  ruleForm.reset();
  ruleForm.country.value = '대한민국';
  ruleForm.priority.value = 100;
  ruleForm.applyAsOverride.checked = true;
  ruleForm.treatAsSingleCluster.checked = false;
  ruleForm.enabled.checked = true;
}

function fillRuleForm(rule) {
  ruleForm.name.value = rule.name || '';
  ruleForm.ruleType.value = rule.ruleType || 'polygon';
  ruleForm.country.value = rule.country || '대한민국';
  ruleForm.state.value = rule.state || '';
  ruleForm.city.value = rule.city || '';
  ruleForm.building.value = rule.building || '';
  ruleForm.priority.value = rule.priority ?? 100;
  ruleForm.applyAsOverride.checked = rule.applyAsOverride !== false;
  ruleForm.treatAsSingleCluster.checked = rule.treatAsSingleCluster === true;
  ruleForm.enabled.checked = rule.enabled !== false;
}

function cancelEditing(silent = true) {
  editingRuleId = null;
  editingRuleSnapshot = null;
  clearEditingArtifacts();
  setEditingButtons(false);
  if (!silent) setPreviewOutput('편집이 취소되었습니다.');
}

function polygonGeometryToLatLngs(geometry) {
  return (geometry.coordinates || []).slice(0, -1).map(([lng, lat]) => L.latLng(lat, lng));
}

function getEditingLatLngs() {
  return editingPolygon?.getLatLngs()?.[0] || [];
}

function getEditingGeometry() {
  if (!editingPolygon) return null;
  const latlngs = getEditingLatLngs();
  if (latlngs.length < 3) return null;
  const coordinates = latlngs.map((p) => [p.lng, p.lat]);
  coordinates.push([latlngs[0].lng, latlngs[0].lat]);
  return { type: 'Polygon', coordinates };
}

function setEditingLatLngs(latlngs) {
  if (!editingPolygon) return;
  editingPolygon.setLatLngs(latlngs);
}

function syncPolygonFromHandles() {
  if (!editingPolygon) return;
  const latlngs = editingHandles.map((handle) => handle.getLatLng());
  setEditingLatLngs(latlngs);
}

function midpoint(a, b) {
  return L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
}

function addVertexAt(index, latlng) {
  const latlngs = [...getEditingLatLngs()];
  latlngs.splice(index, 0, latlng);
  setEditingLatLngs(latlngs);
  renderEditHandles();
}

function removeVertexAt(index) {
  const latlngs = [...getEditingLatLngs()];
  if (latlngs.length <= 3) {
    alert('polygon은 최소 3개의 꼭짓점이 필요합니다.');
    return;
  }
  latlngs.splice(index, 1);
  setEditingLatLngs(latlngs);
  renderEditHandles();
}

function renderEditHandles() {
  if (!editingPolygon) return;
  editLayer.clearLayers();
  editLayer.addLayer(editingPolygon);
  editingHandles = [];
  editingMidpoints = [];

  const latlngs = [...getEditingLatLngs()];

  latlngs.forEach((latlng, index) => {
    const marker = L.marker(latlng, {
      draggable: true,
      icon: getVertexIcon(),
      autoPan: true,
      keyboard: false,
      bubblingMouseEvents: false,
    });

    marker.on('drag', () => {
      latlngs[index] = marker.getLatLng();
      setEditingLatLngs(latlngs);
    });

    marker.on('dragend', () => {
      syncPolygonFromHandles();
      renderEditHandles();
      setPreviewOutput(`편집 중: ${editingRuleSnapshot?.name || ''} / 꼭짓점 ${index + 1} 이동됨`);
    });

    marker.on('dblclick', (event) => {
      L.DomEvent.stop(event);
      removeVertexAt(index);
      setPreviewOutput(`편집 중: ${editingRuleSnapshot?.name || ''} / 꼭짓점 ${index + 1} 삭제됨`);
    });

    marker.addTo(editLayer);
    editingHandles.push(marker);
  });

  for (let i = 0; i < latlngs.length; i += 1) {
    const nextIndex = (i + 1) % latlngs.length;
    const mid = midpoint(latlngs[i], latlngs[nextIndex]);
    const marker = L.marker(mid, {
      draggable: false,
      icon: getMidpointIcon(),
      keyboard: false,
      bubblingMouseEvents: false,
    });
    marker.on('click', (event) => {
      L.DomEvent.stop(event);
      addVertexAt(nextIndex, mid);
      setPreviewOutput(`편집 중: ${editingRuleSnapshot?.name || ''} / 선분에 꼭짓점 추가됨`);
    });
    marker.addTo(editLayer);
    editingMidpoints.push(marker);
  }
}

function startEditingRule(ruleId) {
  const rule = getRuleById(ruleId);
  if (!rule) throw new Error('rule을 찾을 수 없습니다.');
  if (rule.geometry?.type !== 'Polygon') throw new Error('현재는 polygon만 편집할 수 있습니다.');

  cancelEditing();
  drawMode = null;
  resetDraft();

  editingRuleId = ruleId;
  editingRuleSnapshot = JSON.parse(JSON.stringify(rule));
  fillRuleForm(editingRuleSnapshot);
  const latlngs = polygonGeometryToLatLngs(rule.geometry);
  editingPolygon = L.polygon(latlngs, {
    color: '#ef4444',
    weight: 3,
    fillOpacity: 0.12,
    dashArray: '6, 6',
  }).addTo(editLayer);
  renderEditHandles();
  setEditingButtons(true);
  map.fitBounds(editingPolygon.getBounds(), { padding: [20, 20] });
  setPreviewOutput(`편집 시작: ${rule.name}\n꼭짓점을 드래그해 이동, 작은 점 탭으로 추가, 꼭짓점 더블탭으로 삭제할 수 있습니다.`);
  if (isMobileLayout()) setMobilePanelOpen(true);
  document.querySelector('.panel-section[data-section="editor"]')?.classList.add('is-open');
}

function getRulePayloadFromForm(geometry) {
  const formData = new FormData(ruleForm);
  return {
    name: formData.get('name'),
    ruleType: formData.get('ruleType'),
    geometry,
    country: formData.get('country'),
    state: formData.get('state'),
    city: formData.get('city'),
    building: formData.get('building'),
    priority: Number(formData.get('priority') || 100),
    applyAsOverride: formData.get('applyAsOverride') === 'on',
    treatAsSingleCluster: formData.get('treatAsSingleCluster') === 'on',
    enabled: formData.get('enabled') === 'on',
  };
}

async function saveEditing() {
  if (!editingRuleId || !editingRuleSnapshot) return;
  const geometry = getEditingGeometry();
  if (!geometry) throw new Error('유효한 polygon이 아닙니다.');

  const payload = getRulePayloadFromForm(geometry);
  payload.ruleType = 'polygon';

  const result = await fetchJson(`/api/rules/${editingRuleId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  cancelEditing();
  await loadRules();
  setPreviewOutput(JSON.stringify({ message: 'polygon 수정 저장 완료', rule: result.rule }, null, 2));
  if (isMobileLayout()) setMobilePanelOpen(false);
  return result.rule;
}

async function applyRuleById(ruleId) {
  const result = await fetchJson(`/api/rules/${ruleId}/apply`, { method: 'POST' });
  await loadClusters();
  setPreviewOutput(JSON.stringify(result, null, 2));
}

function renderRules(rules) {
  currentRules = rules;
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
      <div>override: ${rule.applyAsOverride ? 'on' : 'off'} / single cluster: ${rule.treatAsSingleCluster ? 'on' : 'off'}</div>
      <div>${rule.state || ''} ${rule.city || ''} ${rule.building || ''}</div>
      <div class="rule-actions">
        <button type="button" data-action="preview">preview</button>
        <button type="button" data-action="apply">apply</button>
        <button type="button" data-action="edit">edit</button>
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

    item.querySelector('[data-action="edit"]').addEventListener('click', async () => {
      startEditingRule(rule.id);
    });

    item.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      if (!confirm(`rule \"${rule.name}\" 를 삭제할까요?`)) return;
      const res = await fetch(`/api/rules/${rule.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '삭제 실패');
      }
      if (editingRuleId === rule.id) {
        cancelEditing();
        resetRuleForm();
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
      const polygon = L.polygon(latlngs, {
        color: rule.treatAsSingleCluster ? '#7c3aed' : '#2563eb',
        weight: rule.treatAsSingleCluster ? 3 : 2,
        fillOpacity: rule.treatAsSingleCluster ? 0.12 : 0.08,
      }).bindPopup(`${rule.name}<br><button type="button" data-rule-edit="${rule.id}">편집</button>`);

      polygon.on('popupopen', (event) => {
        const button = event.popup.getElement()?.querySelector(`[data-rule-edit="${rule.id}"]`);
        if (button) {
          button.addEventListener('click', () => startEditingRule(rule.id), { once: true });
        }
      });

      polygon.addTo(ruleLayer);
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
document.getElementById('clear-shape').addEventListener('click', () => resetDraft());
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
mobilePanelToggle.addEventListener('click', () => setMobilePanelOpen(!document.body.classList.contains('mobile-panel-open')));
mobilePanelBackdrop.addEventListener('click', () => setMobilePanelOpen(false));
toolbarMoreToggle.addEventListener('click', () => setToolbarSecondaryOpen(!toolbarSecondary.classList.contains('is-open')));
document.querySelectorAll('[data-panel-toggle]').forEach((button) => {
  button.addEventListener('click', () => toggleSection(button.dataset.panelToggle));
});
saveEditButton.addEventListener('click', () => saveEditing().catch((error) => {
  console.error(error);
  alert(error.message);
}));
cancelEditButton.addEventListener('click', () => {
  cancelEditing(false);
  resetRuleForm();
});

async function handleRuleSubmit(submitMode) {
  if (editingRuleId) {
    const savedRule = await saveEditing();
    if (submitMode === 'save-apply' && savedRule?.id) {
      await applyRuleById(savedRule.id);
    }
    resetRuleForm();
    return;
  }

  const geometry = getDraftGeometry();
  if (!geometry) {
    alert('먼저 지도에서 point 또는 polygon을 그려주세요.');
    return;
  }

  const payload = getRulePayloadFromForm(geometry);

  const created = await fetchJson('/api/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (submitMode === 'save-apply' && created?.rule?.id) {
    await applyRuleById(created.rule.id);
  }

  resetRuleForm();
  resetDraft();
  await loadRules();
  alert('rule이 저장되었습니다.');
  if (isMobileLayout()) setMobilePanelOpen(false);
}

ruleForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitMode = event.submitter?.dataset?.submitMode || 'save';
  await handleRuleSubmit(submitMode);
});

async function submitRuleForm(mode) {
  await handleRuleSubmit(mode);
}

saveRuleButton.addEventListener('click', () => submitRuleForm('save').catch((error) => {
  console.error(error);
  alert(error.message);
}));
saveApplyRuleButton.addEventListener('click', () => submitRuleForm('save-apply').catch((error) => {
  console.error(error);
  alert(error.message);
}));

resetRuleForm();
setMobilePanelOpen(false);
setToolbarSecondaryOpen(false);
Promise.all([loadRules(), loadClusters()]).catch((error) => {
  console.error(error);
  alert(error.message);
});
