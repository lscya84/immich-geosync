let map = null;
let clusterLoadTimer = null;
let clusterRequestSeq = 0;
let latestClusterRenderSeq = 0;
let draftShape = null;
let draftGuideLine = null;
let editingPolygon = null;
let selectedPhotoMarker = null;
let ruleInfoWindow = null;
const ruleOverlays = [];
const clusterOverlays = [];

const ruleForm = document.getElementById('rule-form');
const saveRuleButton = document.getElementById('save-rule-button');
const saveApplyRuleButton = document.getElementById('save-apply-rule-button');
const saveEditButton = document.getElementById('save-edit');
const cancelEditButton = document.getElementById('cancel-edit');
const editorSectionTitle = document.getElementById('editor-section-title');
const editorModeHint = document.getElementById('editor-mode-hint');
const mobilePanelToggle = document.getElementById('mobile-panel-toggle');
const mobilePanelBackdrop = document.getElementById('mobile-panel-backdrop');
const mapWrap = document.querySelector('.map-wrap');
const mapStage = document.querySelector('.map-stage');
const photoPanel = document.getElementById('photo-panel');
const photoPanelTitle = document.getElementById('photo-panel-title');
const photoPanelSubtitle = document.getElementById('photo-panel-subtitle');
const photoPanelList = document.getElementById('photo-panel-list');
const photoPanelStatus = document.getElementById('photo-panel-status');
const photoPanelCloseButton = document.getElementById('photo-panel-close');
const photoLightbox = document.getElementById('photo-lightbox');
const photoLightboxBackdrop = document.getElementById('photo-lightbox-backdrop');
const photoLightboxCloseButton = document.getElementById('photo-lightbox-close');
const photoLightboxPrevButton = document.getElementById('photo-lightbox-prev');
const photoLightboxNextButton = document.getElementById('photo-lightbox-next');
const photoLightboxImage = document.getElementById('photo-lightbox-image');
const photoLightboxTitle = document.getElementById('photo-lightbox-title');
const photoLightboxDate = document.getElementById('photo-lightbox-date');

let drawMode = null;
let draftPoints = [];
let currentRules = [];
let editingRuleId = null;
let editingRuleSnapshot = null;
let activePhotoCluster = null;
let activePhotoOffset = 0;
let activePhotoLoading = false;
let activePhotoHasMore = false;
let activePhotoRequestKey = 0;
let activePhotoLastDateKey = '';
let activePhotoSectionGrid = null;
let activePhotoAssets = [];
let activeLightboxIndex = -1;
const photoPageSize = 12;

const defaultEditorHint = 'polygon은 3개 이상 점을 찍고 완료하세요. 완료(✓)를 누르면 중심점 기준으로 시/도와 도시/구/동을 자동 채웁니다. 편집 중에는 꼭짓점을 드래그해 이동하고 중간점을 드래그해 꼭짓점을 추가할 수 있습니다.';

function isMobileLayout() {
  return window.matchMedia('(max-width: 900px)').matches;
}

function setMobilePanelOpen(open) {
  document.body.classList.toggle('mobile-panel-open', open);
  mobilePanelToggle.textContent = open ? '패널 닫기' : '패널 열기';
  mobilePanelToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function toggleSection(sectionName) {
  const section = document.querySelector(`.panel-section[data-section="${sectionName}"]`);
  if (!section) return;
  const isOpen = !section.classList.contains('is-open');
  section.classList.toggle('is-open', isOpen);
  const button = section.querySelector('.panel-section-toggle');
  if (button) button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function setPreviewOutput(value) {
  document.getElementById('preview-output').textContent = value;
}

function getAssetDateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatAssetDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatAssetDateGroupLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
}

function syncMapLayout() {
  if (!map) return;
  window.setTimeout(() => {
    naver.maps.Event.trigger(map, 'resize');
    const center = map.getCenter();
    if (center) map.setCenter(center);
  }, 0);
}

function setPhotoPanelOpen(open) {
  mapWrap?.classList.toggle('photo-panel-open', open);
  mapStage?.classList.toggle('photo-panel-open', open);
  photoPanel?.setAttribute('aria-hidden', open ? 'false' : 'true');
  syncMapLayout();
}

function setPhotoLightboxOpen(open) {
  photoLightbox?.classList.toggle('is-open', open);
  photoLightbox?.setAttribute('aria-hidden', open ? 'false' : 'true');
}

function toLatLng(point) {
  return new naver.maps.LatLng(point.lat, point.lng);
}

function createLatLngLiteral(lat, lng) {
  return { lat: Number(lat), lng: Number(lng) };
}

function latLngToLiteral(latLng) {
  return createLatLngLiteral(latLng.y, latLng.x);
}

function clearOverlay(overlay) {
  if (overlay) overlay.setMap(null);
}

function clearOverlayList(list) {
  while (list.length) {
    clearOverlay(list.pop());
  }
}

function kvoArrayToArray(pathLike) {
  const result = [];
  if (!pathLike) return result;
  if (typeof pathLike.getLength === 'function' && typeof pathLike.getAt === 'function') {
    for (let i = 0; i < pathLike.getLength(); i += 1) {
      result.push(pathLike.getAt(i));
    }
    return result;
  }
  if (Array.isArray(pathLike)) return pathLike;
  return result;
}

function polygonPathToCoordinates(pathLike) {
  return kvoArrayToArray(pathLike).map((latLng) => [latLng.x, latLng.y]);
}

function geometryToPath(geometry) {
  const coordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : [];
  const ring = coordinates.slice();
  if (ring.length > 1) {
    const [firstLng, firstLat] = ring[0];
    const [lastLng, lastLat] = ring[ring.length - 1];
    if (firstLng === lastLng && firstLat === lastLat) ring.pop();
  }
  return ring.map(([lng, lat]) => toLatLng(createLatLngLiteral(lat, lng)));
}

function createPolygonBounds(path) {
  const bounds = new naver.maps.LatLngBounds();
  path.forEach((latLng) => bounds.extend(latLng));
  return bounds;
}

function createRulePolygon(path, rule, extraOptions = {}) {
  return new naver.maps.Polygon({
    map,
    paths: path,
    strokeColor: extraOptions.strokeColor || (rule?.treatAsSingleCluster ? '#7c3aed' : '#2563eb'),
    strokeWeight: extraOptions.strokeWeight || (rule?.treatAsSingleCluster ? 3 : 2),
    strokeOpacity: 0.95,
    fillColor: extraOptions.fillColor || (rule?.treatAsSingleCluster ? '#8b5cf6' : '#3b82f6'),
    fillOpacity: extraOptions.fillOpacity ?? (rule?.treatAsSingleCluster ? 0.12 : 0.08),
    clickable: extraOptions.clickable ?? true,
    zIndex: extraOptions.zIndex || 10,
  });
}

function createHtmlMarker(position, className, size, innerHtml) {
  return new naver.maps.Marker({
    map,
    position,
    icon: {
      content: `<div class="${className}" style="width:${size}px;height:${size}px;">${innerHtml || ''}</div>`,
      size: new naver.maps.Size(size, size),
      anchor: new naver.maps.Point(size / 2, size / 2),
    },
  });
}

function renderSelectedPhotoMarker(asset) {
  clearOverlay(selectedPhotoMarker);
  selectedPhotoMarker = null;
  if (!asset || !Number.isFinite(Number(asset.latitude)) || !Number.isFinite(Number(asset.longitude))) return;
  selectedPhotoMarker = createHtmlMarker(
    toLatLng(createLatLngLiteral(asset.latitude, asset.longitude)),
    'selected-photo-marker',
    20,
    '<div class="selected-photo-marker-inner"></div>',
  );
}

function selectPhotoCard(assetId) {
  photoPanelList?.querySelectorAll('.photo-card').forEach((node) => {
    node.classList.toggle('is-selected', node.dataset.assetId === assetId);
  });
}

function syncLightboxNavButtons() {
  if (photoLightboxPrevButton) photoLightboxPrevButton.disabled = activeLightboxIndex <= 0;
  if (photoLightboxNextButton) {
    photoLightboxNextButton.disabled = activeLightboxIndex < 0 || (!activePhotoHasMore && activeLightboxIndex >= activePhotoAssets.length - 1);
  }
}

function openPhotoLightboxByIndex(index) {
  const asset = activePhotoAssets[index];
  if (!asset || !photoLightboxImage) return;
  activeLightboxIndex = index;
  photoLightboxImage.src = asset.previewUrl;
  photoLightboxImage.alt = asset.originalFileName || asset.assetId;
  if (photoLightboxTitle) photoLightboxTitle.textContent = asset.originalFileName || asset.assetId;
  if (photoLightboxDate) photoLightboxDate.textContent = `${formatAssetDate(asset.fileCreatedAt)} · ${asset.state || ''} ${asset.city || ''}`.trim();
  selectPhotoCard(asset.assetId);
  renderSelectedPhotoMarker(asset);
  syncLightboxNavButtons();
  setPhotoLightboxOpen(true);
}

function openPhotoLightbox(asset) {
  const index = activePhotoAssets.findIndex((item) => item.assetId === asset.assetId);
  openPhotoLightboxByIndex(index >= 0 ? index : 0);
}

function closePhotoLightbox() {
  if (photoLightboxImage) photoLightboxImage.src = '';
  activeLightboxIndex = -1;
  syncLightboxNavButtons();
  setPhotoLightboxOpen(false);
}

async function movePhotoLightbox(direction) {
  let nextIndex = activeLightboxIndex + direction;
  if (nextIndex < 0) return;
  if (nextIndex >= activePhotoAssets.length) {
    if (direction > 0 && activePhotoHasMore) {
      if (photoLightboxDate) photoLightboxDate.textContent = '다음 사진을 불러오는 중입니다...';
      const loaded = await loadMoreClusterPhotos();
      if (!loaded) {
        openPhotoLightboxByIndex(activeLightboxIndex);
        return;
      }
    } else {
      return;
    }
    nextIndex = activeLightboxIndex + direction;
    if (nextIndex >= activePhotoAssets.length) return;
  }
  openPhotoLightboxByIndex(nextIndex);
}

function resetPhotoPanel() {
  activePhotoCluster = null;
  activePhotoOffset = 0;
  activePhotoLoading = false;
  activePhotoHasMore = false;
  activePhotoRequestKey += 1;
  activePhotoLastDateKey = '';
  activePhotoSectionGrid = null;
  activePhotoAssets = [];
  activeLightboxIndex = -1;
  clearOverlay(selectedPhotoMarker);
  selectedPhotoMarker = null;
  if (photoPanelTitle) photoPanelTitle.textContent = '사진';
  if (photoPanelSubtitle) photoPanelSubtitle.textContent = '';
  if (photoPanelList) photoPanelList.innerHTML = '';
  if (photoPanelStatus) photoPanelStatus.textContent = '마커를 선택하면 사진이 표시됩니다.';
  setPhotoPanelOpen(false);
}

function appendPhotoCards(assets) {
  if (!photoPanelList) return;
  const fragment = document.createDocumentFragment();
  assets.forEach((asset) => {
    const dateKey = getAssetDateKey(asset.fileCreatedAt);
    if (dateKey && dateKey !== activePhotoLastDateKey) {
      const section = document.createElement('section');
      section.className = 'photo-date-section';

      const heading = document.createElement('div');
      heading.className = 'photo-date-group';
      heading.textContent = formatAssetDateGroupLabel(asset.fileCreatedAt);
      section.appendChild(heading);

      const grid = document.createElement('div');
      grid.className = 'photo-grid';
      section.appendChild(grid);

      fragment.appendChild(section);
      activePhotoLastDateKey = dateKey;
      activePhotoSectionGrid = grid;
    }

    if (!activePhotoSectionGrid) {
      const section = document.createElement('section');
      section.className = 'photo-date-section';
      const grid = document.createElement('div');
      grid.className = 'photo-grid';
      section.appendChild(grid);
      fragment.appendChild(section);
      activePhotoSectionGrid = grid;
    }

    const link = document.createElement('a');
    link.className = 'photo-card';
    link.href = asset.previewUrl;
    link.dataset.assetId = asset.assetId;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      openPhotoLightbox(asset);
    });
    link.innerHTML = `
      <img class="photo-card-image" src="${asset.thumbnailUrl || asset.previewUrl}" alt="${asset.originalFileName || asset.assetId}" loading="lazy" />
    `;
    const image = link.querySelector('.photo-card-image');
    if (image && asset.previewUrl && asset.thumbnailUrl && asset.thumbnailUrl !== asset.previewUrl) {
      image.addEventListener('error', () => {
        if (image.dataset.fallbackApplied === 'true') return;
        image.dataset.fallbackApplied = 'true';
        image.src = asset.previewUrl;
      }, { once: true });
    }
    activePhotoSectionGrid.appendChild(link);
  });
  photoPanelList.appendChild(fragment);
}

async function loadMoreClusterPhotos() {
  if (!activePhotoCluster || activePhotoLoading || !activePhotoHasMore) return 0;
  activePhotoLoading = true;
  const requestKey = activePhotoRequestKey;
  if (photoPanelStatus) photoPanelStatus.textContent = '사진을 불러오는 중입니다...';
  try {
    const result = activePhotoCluster.isMergedDisplayCluster
      ? await fetchJson('/api/clusters/assets/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sources: (activePhotoCluster.sourceClusters || []).map((source) => ({
            ruleId: source.ruleId || '',
            latitude: source.latitude,
            longitude: source.longitude,
            precision: source.precision,
          })),
          limit: photoPageSize,
          offset: activePhotoOffset,
        }),
      })
      : await fetchJson(`/api/clusters/assets?${activePhotoCluster.ruleId
        ? `ruleId=${encodeURIComponent(activePhotoCluster.ruleId)}`
        : `latitude=${encodeURIComponent(activePhotoCluster.latitude)}&longitude=${encodeURIComponent(activePhotoCluster.longitude)}&precision=${encodeURIComponent(activePhotoCluster.precision || 5)}`}&limit=${photoPageSize}&offset=${activePhotoOffset}`);
    if (requestKey !== activePhotoRequestKey) return 0;
    const assets = result.assets || [];
    activePhotoAssets.push(...assets);
    appendPhotoCards(assets);
    activePhotoOffset += assets.length;
    activePhotoHasMore = typeof result.hasMore === 'boolean' ? result.hasMore : assets.length === photoPageSize;
    if (photoPanelStatus) {
      photoPanelStatus.textContent = activePhotoHasMore ? '아래로 스크롤하면 더 과거 사진을 불러옵니다.' : '마지막 사진까지 표시했습니다.';
    }
    syncLightboxNavButtons();
    return assets.length;
  } catch (error) {
    if (photoPanelStatus) photoPanelStatus.textContent = error.message || '사진을 불러오지 못했습니다.';
    return 0;
  } finally {
    activePhotoLoading = false;
  }
}

async function openPhotoPanelForCluster(cluster) {
  activePhotoCluster = cluster;
  activePhotoOffset = 0;
  activePhotoLoading = false;
  activePhotoHasMore = true;
  activePhotoRequestKey += 1;
  activePhotoLastDateKey = '';
  activePhotoSectionGrid = null;
  activePhotoAssets = [];
  activeLightboxIndex = -1;
  clearOverlay(selectedPhotoMarker);
  selectedPhotoMarker = null;
  photoPanelList?.classList.add('is-swapping');
  if (photoPanelTitle) photoPanelTitle.textContent = `사진 ${cluster.assetCount}장`;
  if (photoPanelSubtitle) photoPanelSubtitle.textContent = `${cluster.state || ''} ${cluster.city || ''}`.trim();
  if (photoPanelList) {
    photoPanelList.innerHTML = '';
    photoPanelList.scrollTop = 0;
  }
  if (photoPanelStatus) photoPanelStatus.textContent = '사진을 불러오는 중입니다...';
  setPhotoPanelOpen(true);
  await loadMoreClusterPhotos();
  photoPanelList?.classList.remove('is-swapping');
  syncLightboxNavButtons();
}

function setEditingButtons(enabled) {
  saveEditButton.disabled = !enabled;
  cancelEditButton.disabled = !enabled;
}

function updateEditorModeUi() {
  const isEditing = Boolean(editingRuleId);
  saveRuleButton.disabled = isEditing;
  saveApplyRuleButton.disabled = isEditing;

  if (editorSectionTitle) {
    editorSectionTitle.textContent = isEditing ? '규칙 편집 중' : '규칙 추가';
  }

  if (editorModeHint) {
    editorModeHint.textContent = isEditing
      ? '편집 중입니다. 꼭짓점을 드래그해 수정한 뒤 지도 오른쪽 위의 💾 버튼으로 저장하세요.'
      : defaultEditorHint;
  }
}

function getRuleById(ruleId) {
  return currentRules.find((rule) => rule.id === ruleId) || null;
}

function clearEditingArtifacts() {
  if (editingPolygon) {
    if (typeof editingPolygon.setEditable === 'function') editingPolygon.setEditable(false);
    editingPolygon.setMap(null);
  }
  editingPolygon = null;
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
  ruleForm.country.value = rule.country || '대한민국';
  ruleForm.state.value = rule.state || '';
  ruleForm.city.value = rule.city || '';
  ruleForm.priority.value = rule.priority ?? 100;
  ruleForm.applyAsOverride.checked = rule.applyAsOverride !== false;
  ruleForm.treatAsSingleCluster.checked = rule.treatAsSingleCluster === true;
  ruleForm.enabled.checked = rule.enabled !== false;
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
  clearOverlay(draftGuideLine);
  clearOverlay(draftShape);
  draftGuideLine = null;
  draftShape = null;

  if (drawMode !== 'polygon' || draftPoints.length === 0 || !map) return;
  const path = draftPoints.map(toLatLng);

  if (path.length < 3) {
    draftGuideLine = new naver.maps.Polyline({
      map,
      path,
      strokeColor: '#ef4444',
      strokeOpacity: 0.95,
      strokeWeight: 3,
      zIndex: 20,
    });
    return;
  }

  draftShape = new naver.maps.Polygon({
    map,
    paths: path,
    strokeColor: '#ef4444',
    strokeOpacity: 0.95,
    strokeWeight: 3,
    fillColor: '#f87171',
    fillOpacity: 0.12,
    zIndex: 20,
  });
}

function getDraftGeometry() {
  if (drawMode === 'polygon' && draftPoints.length >= 3) {
    const coordinates = draftPoints.map((point) => [point.lng, point.lat]);
    coordinates.push([draftPoints[0].lng, draftPoints[0].lat]);
    return { type: 'Polygon', coordinates };
  }
  return null;
}

function getPolygonCentroid(geometry) {
  const coordinates = Array.isArray(geometry?.coordinates)
    ? geometry.coordinates.filter((pair) => Array.isArray(pair) && pair.length >= 2)
    : [];
  if (coordinates.length < 3) return null;

  const ring = [...coordinates];
  const [firstLon, firstLat] = ring[0];
  const [lastLon, lastLat] = ring[ring.length - 1];
  if (firstLon !== lastLon || firstLat !== lastLat) {
    ring.push([firstLon, firstLat]);
  }

  let areaFactor = 0;
  let centroidLon = 0;
  let centroidLat = 0;

  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x0, y0] = ring[i].map(Number);
    const [x1, y1] = ring[i + 1].map(Number);
    const cross = x0 * y1 - x1 * y0;
    areaFactor += cross;
    centroidLon += (x0 + x1) * cross;
    centroidLat += (y0 + y1) * cross;
  }

  if (Math.abs(areaFactor) < Number.EPSILON) {
    const points = ring.slice(0, -1);
    return {
      lng: points.reduce((sum, [lng]) => sum + Number(lng), 0) / points.length,
      lat: points.reduce((sum, [, lat]) => sum + Number(lat), 0) / points.length,
    };
  }

  return {
    lng: centroidLon / (areaFactor * 3),
    lat: centroidLat / (areaFactor * 3),
  };
}

async function autofillAddressFromGeometry(geometry) {
  if (!geometry || geometry.type !== 'Polygon') return;
  const centroid = getPolygonCentroid(geometry);
  if (!centroid) return;

  setPreviewOutput('폴리곤 중심점 기준 주소를 조회하는 중입니다...');
  const result = await fetchJson('/api/reverse-geocode/centroid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ geometry }),
  });

  ruleForm.country.value = result.address?.country || '대한민국';
  ruleForm.state.value = result.address?.state || '';
  ruleForm.city.value = result.address?.city || '';
  setPreviewOutput(JSON.stringify({
    message: '폴리곤 중심점 기준 주소를 자동으로 채웠습니다.',
    centroid: result.centroid,
    address: result.address,
  }, null, 2));
}

function cancelEditing(silent = true) {
  editingRuleId = null;
  editingRuleSnapshot = null;
  clearEditingArtifacts();
  setEditingButtons(false);
  updateEditorModeUi();
  if (!silent) setPreviewOutput('편집이 취소되었습니다.');
}

function getEditingGeometry() {
  if (!editingPolygon || typeof editingPolygon.getPath !== 'function') return null;
  const coordinates = polygonPathToCoordinates(editingPolygon.getPath());
  if (coordinates.length < 3) return null;
  coordinates.push([...coordinates[0]]);
  return { type: 'Polygon', coordinates };
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
  const path = geometryToPath(rule.geometry);
  editingPolygon = createRulePolygon(path, rule, {
    strokeColor: '#ef4444',
    strokeWeight: 3,
    fillColor: '#f87171',
    fillOpacity: 0.12,
    zIndex: 30,
  });
  if (typeof editingPolygon.setEditable === 'function') editingPolygon.setEditable(true);
  setEditingButtons(true);
  updateEditorModeUi();
  map.fitBounds(createPolygonBounds(path), { top: 20, right: 20, bottom: 20, left: 20 });
  setPreviewOutput(`편집 시작: ${rule.name}\n꼭짓점과 중간점을 드래그해 polygon을 수정한 뒤 저장하세요.`);
  if (isMobileLayout()) setMobilePanelOpen(true);
  document.querySelector('.panel-section[data-section="editor"]')?.classList.add('is-open');
}

function getRulePayloadFromForm(geometry) {
  const formData = new FormData(ruleForm);
  return {
    name: formData.get('name'),
    ruleType: 'polygon',
    geometry,
    country: formData.get('country'),
    state: formData.get('state'),
    city: formData.get('city'),
    building: '',
    priority: Number(formData.get('priority') || 100),
    applyAsOverride: formData.get('applyAsOverride') === 'on',
    treatAsSingleCluster: formData.get('treatAsSingleCluster') === 'on',
    enabled: formData.get('enabled') === 'on',
  };
}

async function saveEditing() {
  if (!editingRuleId || !editingRuleSnapshot) return null;
  const geometry = getEditingGeometry();
  if (!geometry) throw new Error('유효한 polygon이 아닙니다.');

  const payload = getRulePayloadFromForm(geometry);
  payload.ruleType = 'polygon';

  const result = await fetchJson(`/api/rules/${editingRuleId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const applyResult = await fetchJson(`/api/rules/${editingRuleId}/apply`, { method: 'POST' });

  cancelEditing();
  resetPhotoPanel();
  await Promise.all([loadRules(), loadClusters()]);
  setPreviewOutput(JSON.stringify({
    message: 'polygon 수정 저장 및 rule 자동 적용 완료',
    rule: result.rule,
    apply: applyResult,
  }, null, 2));
  if (isMobileLayout()) setMobilePanelOpen(false);
  return result.rule;
}

async function applyRuleById(ruleId) {
  const result = await fetchJson(`/api/rules/${ruleId}/apply`, { method: 'POST' });
  await loadClusters();
  setPreviewOutput(JSON.stringify(result, null, 2));
}

async function previewRuleById(ruleId) {
  const result = await fetchJson(`/api/rules/${ruleId}/preview`, { method: 'POST' });
  setPreviewOutput(JSON.stringify(result, null, 2));
}

async function deleteRuleById(ruleId) {
  const rule = getRuleById(ruleId);
  if (!rule) throw new Error('rule을 찾을 수 없습니다.');
  if (!confirm(`rule \"${rule.name}\" 를 삭제할까요?`)) return false;
  const res = await fetch(`/api/rules/${ruleId}`, { method: 'DELETE' });
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
  return true;
}

function closeRuleInfoWindow() {
  if (ruleInfoWindow) ruleInfoWindow.close();
}

function bindRuleInfoWindowActions(rule) {
  const root = document.querySelector(`.rule-popup[data-rule-id="${rule.id}"]`);
  if (!root) return;
  root.querySelector('[data-action="preview"]')?.addEventListener('click', async () => {
    closeRuleInfoWindow();
    await previewRuleById(rule.id);
  }, { once: true });
  root.querySelector('[data-action="apply"]')?.addEventListener('click', async () => {
    closeRuleInfoWindow();
    await applyRuleById(rule.id);
  }, { once: true });
  root.querySelector('[data-action="edit"]')?.addEventListener('click', () => {
    closeRuleInfoWindow();
    startEditingRule(rule.id);
  }, { once: true });
  root.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    closeRuleInfoWindow();
    await deleteRuleById(rule.id);
  }, { once: true });
}

function openRuleInfoWindow(rule, position) {
  if (!ruleInfoWindow) {
    ruleInfoWindow = new naver.maps.InfoWindow({
      borderWidth: 0,
      backgroundColor: 'transparent',
      disableAnchor: false,
      pixelOffset: new naver.maps.Point(0, -8),
    });
  }

  const content = `
    <div class="rule-popup" data-rule-id="${rule.id}">
      <strong>${rule.name}</strong>
      <div>${rule.state || ''} ${rule.city || ''}</div>
      <div class="popup-actions">
        <button type="button" data-action="preview">preview</button>
        <button type="button" data-action="apply">apply</button>
        <button type="button" data-action="edit">edit</button>
        <button type="button" data-action="delete">delete</button>
      </div>
    </div>
  `;

  ruleInfoWindow.setContent(content);
  ruleInfoWindow.setPosition(position);
  ruleInfoWindow.open(map);
  window.setTimeout(() => bindRuleInfoWindowActions(rule), 0);
}

function renderRules(rules) {
  currentRules = rules;
  const list = document.getElementById('rule-list');
  list.innerHTML = '';
  closeRuleInfoWindow();
  clearOverlayList(ruleOverlays);

  rules.forEach((rule) => {
    const item = document.createElement('li');
    item.className = 'rule-item';
    item.innerHTML = `
      <strong>${rule.name}</strong>
      <div>type: ${rule.ruleType}</div>
      <div>priority: ${rule.priority}</div>
      <div>override: ${rule.applyAsOverride ? 'on' : 'off'} / single cluster: ${rule.treatAsSingleCluster ? 'on' : 'off'}</div>
      <div>${rule.state || ''} ${rule.city || ''}</div>
      <div class="rule-actions">
        <button type="button" data-action="preview">preview</button>
        <button type="button" data-action="apply">apply</button>
        <button type="button" data-action="edit">edit</button>
        <button type="button" data-action="delete">delete</button>
      </div>
    `;
    list.appendChild(item);

    item.querySelector('[data-action="preview"]').addEventListener('click', async () => {
      await previewRuleById(rule.id);
    });

    item.querySelector('[data-action="apply"]').addEventListener('click', async () => {
      if (!confirm(`rule \"${rule.name}\" 를 즉시 적용할까요?`)) return;
      await applyRuleById(rule.id);
    });

    item.querySelector('[data-action="edit"]').addEventListener('click', () => {
      startEditingRule(rule.id);
    });

    item.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      await deleteRuleById(rule.id);
    });

    if (rule.geometry?.type === 'Polygon') {
      const path = geometryToPath(rule.geometry);
      const polygon = createRulePolygon(path, rule);
      ruleOverlays.push(polygon);
      naver.maps.Event.addListener(polygon, 'click', (event) => {
        const position = event?.coord || createPolygonBounds(path).getCenter();
        openRuleInfoWindow(rule, position);
      });
    }
  });
}

function getDisplayClusterGridSize(zoom) {
  if (zoom <= 7) return 0.8;
  if (zoom <= 9) return 0.25;
  if (zoom <= 11) return 0.08;
  if (zoom <= 13) return 0.03;
  return 0;
}

function buildDisplayClusters(clusters) {
  const zoom = map?.getZoom?.() || 7;
  const gridSize = getDisplayClusterGridSize(zoom);
  if (!gridSize) {
    return clusters.map((cluster) => ({
      ...cluster,
      sourceClusters: [cluster],
      mergedClusterCount: 1,
      isMergedDisplayCluster: false,
    }));
  }

  const grouped = new Map();
  clusters.forEach((cluster) => {
    const latKey = Math.floor(cluster.latitude / gridSize);
    const lngKey = Math.floor(cluster.longitude / gridSize);
    const key = `${latKey}:${lngKey}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        latitudeSum: 0,
        longitudeSum: 0,
        assetCount: 0,
        sourceClusters: [],
      });
    }
    const bucket = grouped.get(key);
    const weight = Math.max(1, Number(cluster.assetCount) || 1);
    bucket.latitudeSum += Number(cluster.latitude) * weight;
    bucket.longitudeSum += Number(cluster.longitude) * weight;
    bucket.assetCount += weight;
    bucket.sourceClusters.push(cluster);
  });

  return [...grouped.values()].map((bucket) => {
    const primary = bucket.sourceClusters[0];
    const mergedClusterCount = bucket.sourceClusters.length;
    return {
      ...primary,
      latitude: bucket.latitudeSum / bucket.assetCount,
      longitude: bucket.longitudeSum / bucket.assetCount,
      assetCount: bucket.assetCount,
      sourceClusters: bucket.sourceClusters,
      mergedClusterCount,
      isMergedDisplayCluster: mergedClusterCount > 1,
    };
  });
}

function createClusterMarker(cluster) {
  const size = Math.max(20, Math.min(44, 16 + Math.round(Math.log2(cluster.assetCount + 1) * 4)));
  const countLabel = cluster.assetCount > 1 ? `<span class="cluster-marker-count">${cluster.assetCount > 999 ? '999+' : cluster.assetCount}</span>` : '';
  const marker = createHtmlMarker(
    toLatLng(createLatLngLiteral(cluster.latitude, cluster.longitude)),
    `cluster-marker${cluster.isMergedDisplayCluster ? ' is-merged' : ''}${cluster.assetCount === 1 ? ' is-single' : ''}`,
    size,
    `<div class="cluster-marker-inner"></div>${countLabel}`,
  );
  naver.maps.Event.addListener(marker, 'click', () => {
    const target = toLatLng(createLatLngLiteral(cluster.latitude, cluster.longitude));
    map.panTo(target);
    openPhotoPanelForCluster(cluster).catch((error) => {
      console.error(error);
      if (photoPanelStatus) photoPanelStatus.textContent = error.message || '사진을 불러오지 못했습니다.';
    });
  });
  return marker;
}

function renderClusters(clusters) {
  clearOverlayList(clusterOverlays);
  buildDisplayClusters(clusters).forEach((cluster) => {
    clusterOverlays.push(createClusterMarker(cluster));
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
  if (!map) return;
  const bounds = map.getBounds();
  const sw = bounds.getSW();
  const ne = bounds.getNE();
  const params = new URLSearchParams({
    south: sw.y.toString(),
    north: ne.y.toString(),
    west: sw.x.toString(),
    east: ne.x.toString(),
    zoom: map.getZoom().toString(),
  });
  const requestSeq = ++clusterRequestSeq;
  const data = await fetchJson(`/api/clusters?${params.toString()}`);
  if (requestSeq < latestClusterRenderSeq) return;
  latestClusterRenderSeq = requestSeq;
  renderClusters(data.clusters);
}

async function handleMapClick(event) {
  if (!drawMode || drawMode !== 'polygon') return;
  draftPoints.push(latLngToLiteral(event.coord));
  renderDraft();
}

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
    alert('먼저 지도에서 polygon을 그려주세요.');
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

async function loadRuntimeConfig() {
  return fetchJson('/api/runtime-config');
}

async function loadNaverMapsScript() {
  if (window.naver?.maps) return;
  const config = await loadRuntimeConfig();
  const clientId = String(config.naverMapsClientId || '').trim();
  if (!clientId) throw new Error('NAVER_MAPS_CLIENT_ID 또는 NAVER_CLIENT_ID가 필요합니다.');

  await new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-naver-maps-sdk="true"]');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error('네이버 지도 SDK를 불러오지 못했습니다.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}&submodules=drawing`;
    script.async = true;
    script.defer = true;
    script.dataset.naverMapsSdk = 'true';
    script.onload = resolve;
    script.onerror = () => reject(new Error('네이버 지도 SDK를 불러오지 못했습니다.')); 
    document.head.appendChild(script);
  });
}

function initializeMap() {
  map = new naver.maps.Map('map', {
    center: toLatLng(createLatLngLiteral(36.5, 127.8)),
    zoom: 7,
    scaleControl: false,
    mapDataControl: false,
    logoControl: true,
  });

  naver.maps.Event.addListener(map, 'click', (event) => {
    handleMapClick(event).catch((error) => console.error(error));
  });

  naver.maps.Event.addListener(map, 'idle', () => {
    if (clusterLoadTimer) clearTimeout(clusterLoadTimer);
    clusterLoadTimer = setTimeout(() => {
      loadClusters().catch((error) => console.error(error));
    }, 180);
  });
}

function bindUiEvents() {
  document.getElementById('start-polygon').addEventListener('click', () => setDrawMode('polygon'));
  document.getElementById('clear-shape').addEventListener('click', () => resetDraft());
  document.getElementById('finish-shape').addEventListener('click', () => {
    const geometry = getDraftGeometry();
    if (!geometry) {
      alert('완성된 도형이 없습니다.');
      return;
    }
    autofillAddressFromGeometry(geometry)
      .then(() => {
        alert('도형이 준비되었고 주소를 자동으로 채웠습니다. 왼쪽 폼에서 저장하세요.');
        if (isMobileLayout()) setMobilePanelOpen(true);
        document.querySelector('.panel-section[data-section="editor"]')?.classList.add('is-open');
      })
      .catch((error) => {
        console.error(error);
        setPreviewOutput(`주소 자동 채우기 실패: ${error.message}`);
        alert(`도형은 준비되었지만 주소 자동 채우기에 실패했습니다.\n${error.message}`);
        if (isMobileLayout()) setMobilePanelOpen(true);
      });
  });
  document.getElementById('refresh-rules').addEventListener('click', loadRules);
  document.getElementById('refresh-clusters').addEventListener('click', () => loadClusters().catch((error) => {
    console.error(error);
  }));
  mobilePanelToggle.addEventListener('click', () => setMobilePanelOpen(!document.body.classList.contains('mobile-panel-open')));
  mobilePanelBackdrop.addEventListener('click', () => setMobilePanelOpen(false));
  photoPanelCloseButton?.addEventListener('click', resetPhotoPanel);
  photoLightboxCloseButton?.addEventListener('click', closePhotoLightbox);
  photoLightboxPrevButton?.addEventListener('click', () => {
    movePhotoLightbox(-1).catch((error) => console.error(error));
  });
  photoLightboxNextButton?.addEventListener('click', () => {
    movePhotoLightbox(1).catch((error) => console.error(error));
  });
  photoLightboxBackdrop?.addEventListener('click', closePhotoLightbox);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePhotoLightbox();
    if (event.key === 'ArrowLeft' && photoLightbox?.classList.contains('is-open')) {
      movePhotoLightbox(-1).catch((error) => console.error(error));
    }
    if (event.key === 'ArrowRight' && photoLightbox?.classList.contains('is-open')) {
      movePhotoLightbox(1).catch((error) => console.error(error));
    }
  });
    photoPanel?.addEventListener('wheel', (event) => {
    event.stopPropagation();
  }, { passive: true });
  photoPanel?.addEventListener('touchmove', (event) => {
    event.stopPropagation();
  }, { passive: true });
  photoPanelList?.addEventListener('scroll', () => {
    if (!photoPanelList || activePhotoLoading || !activePhotoHasMore) return;
    const remaining = photoPanelList.scrollHeight - photoPanelList.scrollTop - photoPanelList.clientHeight;
    if (remaining < 240) {
      loadMoreClusterPhotos().catch((error) => {
        console.error(error);
        if (photoPanelStatus) photoPanelStatus.textContent = error.message || '사진을 불러오지 못했습니다.';
      });
    }
  });
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
  ruleForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitMode = event.submitter?.dataset?.submitMode || 'save';
    await handleRuleSubmit(submitMode);
  });
  saveRuleButton.addEventListener('click', () => handleRuleSubmit('save').catch((error) => {
    console.error(error);
    alert(error.message);
  }));
  saveApplyRuleButton.addEventListener('click', () => handleRuleSubmit('save-apply').catch((error) => {
    console.error(error);
    alert(error.message);
  }));
}

async function init() {
  resetRuleForm();
  updateEditorModeUi();
  setMobilePanelOpen(false);
  resetPhotoPanel();
  bindUiEvents();
  await loadNaverMapsScript();
  initializeMap();
  await Promise.all([loadRules(), loadClusters()]);
}

init().catch((error) => {
  console.error(error);
  alert(error.message);
});
