let map = null;
let clusterLoadTimer = null;
let clusterRequestSeq = 0;
let latestClusterRenderSeq = 0;
let clusterRequestController = null;
let draftShape = null;
let draftGuideLine = null;
let editingPolygon = null;
let selectedPhotoMarker = null;
let ruleInfoWindow = null;
const ruleOverlays = [];
const clusterOverlays = new Map();

const ruleForm = document.getElementById('rule-form');
const saveRuleButton = document.getElementById('save-rule-button');
const saveApplyRuleButton = document.getElementById('save-apply-rule-button');
const ruleModal = document.getElementById('rule-modal');
const ruleModalBackdrop = document.getElementById('rule-modal-backdrop');
const ruleModalCloseButton = document.getElementById('rule-modal-close');
const ruleModalCancelButton = document.getElementById('rule-modal-cancel');
const ruleModalTitle = document.getElementById('rule-modal-title');
const ruleModalHint = document.getElementById('rule-modal-hint');
const startPolygonButton = document.getElementById('start-polygon');
const mobilePanelToggle = document.getElementById('mobile-panel-toggle');
const mobilePanelBackdrop = document.getElementById('mobile-panel-backdrop');
const toggleMergeClustersButton = document.getElementById('toggle-merge-clusters');
const applyMergeClustersButton = document.getElementById('apply-merge-clusters');
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
const previewOutput = document.getElementById('preview-output');
const refreshWorkerButton = document.getElementById('refresh-worker');
const restartWorkerButton = document.getElementById('restart-worker');
const restartAllButton = document.getElementById('restart-all');
const autoRefreshWorkerButton = document.getElementById('auto-refresh-worker');
const copyWorkerLogsButton = document.getElementById('copy-worker-logs');
const downloadWorkerLogsButton = document.getElementById('download-worker-logs');
const workerStatus = document.getElementById('worker-status');
const workerRuns = document.getElementById('worker-runs');
const workerLogs = document.getElementById('worker-logs');
const settingsForm = document.getElementById('settings-form');
const saveSettingsButton = document.getElementById('save-settings');
const settingsStatus = document.getElementById('settings-status');
const restartConfirmModal = document.getElementById('restart-confirm-modal');
const restartConfirmBackdrop = document.getElementById('restart-confirm-backdrop');
const restartConfirmCloseButton = document.getElementById('restart-confirm-close');
const restartConfirmCancelButton = document.getElementById('restart-confirm-cancel');
const restartConfirmApproveButton = document.getElementById('restart-confirm-approve');
const restartConfirmTitle = document.getElementById('restart-confirm-title');
const restartConfirmMessage = document.getElementById('restart-confirm-message');
const refreshCacheButton = document.getElementById('refresh-cache');
const cacheStatus = document.getElementById('cache-status');
const cacheTableBody = document.getElementById('cache-table-body');
const cacheFilterStateSelect = document.getElementById('cache-filter-state');
const cacheFilterCitySelect = document.getElementById('cache-filter-city');
const cachePageSizeSelect = document.getElementById('cache-page-size');
const cachePagination = document.getElementById('cache-pagination');
const navButtons = Array.from(document.querySelectorAll('[data-view-target]'));
const workspaceViews = Array.from(document.querySelectorAll('[data-view]'));

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
let isEditingPhotoLocation = false;
let isSavingPhotoLocation = false;
let isEditingClusterCoordinate = false;
let isSavingClusterCoordinate = false;
let workerAutoRefreshTimer = null;
let workerAutoRefreshEnabled = false;
let latestWorkerLogText = '';
let restartModalOnApprove = null;
let clusterCoordinateDraft = null;
let clusterCoordinateMarker = null;
let isSelectingClustersForMerge = false;
const selectedMergeClusters = new Map();
let lastLoadedClusters = [];
const photoPageSize = 12;
let ruleCountRequestSeq = 0;
let cachePage = 1;
let cachePageSize = Number(cachePageSizeSelect?.value || 100);
let cacheTotalPages = 1;
const DISPLAY_TIME_ZONE = 'Asia/Seoul';
const ADMIN_TOKEN_STORAGE_KEY = 'immich_geosync_admin_token';

function getAdminToken() {
  return String(window.localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || '').trim();
}

function setAdminToken(token) {
  if (!token) {
    window.localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
}

function attachAdminToken(options = {}) {
  const token = getAdminToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set('x-admin-token', token);
  return { ...options, headers };
}

function setActiveView(viewName) {
  navButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.viewTarget === viewName);
  });
  workspaceViews.forEach((view) => {
    view.classList.toggle('is-active', view.dataset.view === viewName);
  });
  setMobilePanelOpen(false);
  if (viewName === 'map') syncMapLayout();
  if (viewName === 'worker') {
    loadWorkerSnapshot().catch((error) => {
      console.error(error);
      if (workerStatus) workerStatus.textContent = error.message || '워커 상태를 불러오지 못했습니다.';
    });
  }
  if (viewName === 'settings') {
    loadSettings().catch((error) => {
      console.error(error);
      if (settingsStatus) settingsStatus.textContent = error.message || '환경 설정을 불러오지 못했습니다.';
    });
  }
  if (viewName === 'cache') {
    loadClusterCacheList().catch((error) => {
      console.error(error);
      if (cacheStatus) cacheStatus.textContent = error.message || '캐시 목록을 불러오지 못했습니다.';
    });
  }
}

function isMobileLayout() {
  return window.matchMedia('(max-width: 900px)').matches;
}

function setMobilePanelOpen(open) {
  document.body.classList.toggle('mobile-panel-open', open);
  mobilePanelToggle.textContent = open ? '✕' : '☰';
  mobilePanelToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  mobilePanelToggle.setAttribute('aria-label', open ? '패널 닫기' : '패널 열기');
  mobilePanelToggle.setAttribute('title', open ? '패널 닫기' : '패널 열기');
  mobilePanelToggle.classList.toggle('is-active', open);
}

function setPreviewOutput(value) {
  if (previewOutput) previewOutput.textContent = value;
}

function setRuleModalOpen(open) {
  ruleModal?.classList.toggle('is-open', open);
  ruleModal?.setAttribute('aria-hidden', open ? 'false' : 'true');
}

function closeRuleModal({ resetForm = true } = {}) {
  setRuleModalOpen(false);
  if (editingRuleId) cancelEditing(false);
  else resetDraft();
  if (resetForm) resetRuleForm();
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

function formatShortDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: DISPLAY_TIME_ZONE,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function appendKeyValueRow(parent, className, key, value) {
  const row = document.createElement('div');
  row.className = className;
  const label = document.createElement('strong');
  label.textContent = key;
  const text = document.createElement('span');
  text.textContent = value || '-';
  row.append(label, text);
  parent.appendChild(row);
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

function clearClusterCoordinateMarker() {
  if (clusterCoordinateMarker) {
    clusterCoordinateMarker.setMap(null);
    clusterCoordinateMarker = null;
  }
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

function getMergeSelectionClusterKey(cluster = {}) {
  return [
    Number(cluster.latitude).toFixed(Number(cluster.precision) || 5),
    Number(cluster.longitude).toFixed(Number(cluster.precision) || 5),
    Number(cluster.precision) || 5,
  ].join(':');
}

function canSelectClusterForMerge(cluster) {
  if (!cluster) return false;
  if (cluster.isMergedDisplayCluster) return false;
  if ((cluster.mergedClusterCount || 1) > 1) return false;
  if (cluster.ruleId || cluster.clusterType === 'single_rule' || cluster.clusterType === 'manual_group') return false;
  return Number.isFinite(Number(cluster.latitude)) && Number.isFinite(Number(cluster.longitude));
}

function isClusterSelectedForMerge(cluster) {
  if (!canSelectClusterForMerge(cluster)) return false;
  return selectedMergeClusters.has(getMergeSelectionClusterKey(cluster));
}

function updateMergeClusterButtons() {
  toggleMergeClustersButton?.classList.toggle('is-active', isSelectingClustersForMerge);
  if (toggleMergeClustersButton) {
    toggleMergeClustersButton.title = isSelectingClustersForMerge ? '클러스터 병합 선택 종료' : '클러스터 병합 선택';
    toggleMergeClustersButton.setAttribute('aria-label', isSelectingClustersForMerge ? '클러스터 병합 선택 종료' : '클러스터 병합 선택');
  }
  if (applyMergeClustersButton) {
    applyMergeClustersButton.disabled = selectedMergeClusters.size < 2;
    applyMergeClustersButton.title = selectedMergeClusters.size >= 2
      ? `선택한 ${selectedMergeClusters.size}개 클러스터 병합`
      : '선택한 클러스터 병합';
  }
}

function refreshClusterMarkerIcons() {
  for (const marker of clusterOverlays.values()) {
    const cluster = marker.__cluster;
    if (!cluster) continue;
    marker.setIcon(buildClusterMarkerIcon(cluster));
    marker.__signature = getClusterRenderSignature(cluster);
  }
}

function clearSelectedMergeClusters({ preserveMode = false } = {}) {
  selectedMergeClusters.clear();
  if (!preserveMode) isSelectingClustersForMerge = false;
  updateMergeClusterButtons();
  refreshClusterMarkerIcons();
}

function toggleMergeClusterSelection(cluster) {
  if (!canSelectClusterForMerge(cluster)) return false;
  const key = getMergeSelectionClusterKey(cluster);
  if (selectedMergeClusters.has(key)) {
    selectedMergeClusters.delete(key);
  } else {
    selectedMergeClusters.set(key, {
      latitude: Number(cluster.latitude),
      longitude: Number(cluster.longitude),
      precision: Number(cluster.precision) || 5,
      state: cluster.state || '',
      city: cluster.city || '',
      assetCount: Number(cluster.assetCount) || 0,
    });
  }
  updateMergeClusterButtons();
  refreshClusterMarkerIcons();
  return true;
}

function formatClusterLocation(cluster = {}) {
  return `${cluster.state || ''} ${cluster.city || ''}`.trim();
}

function getClusterDisplayName(cluster = {}) {
  const savedName = String(cluster.name || '').trim();
  if (savedName && (cluster.clusterType === 'manual_group' || cluster.clusterType === 'single_rule' || cluster.ruleId)) {
    return savedName;
  }
  return formatClusterLocation(cluster);
}

function formatCoordinateValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return number.toFixed(6);
}

function getActiveClusterCoordinateDraft() {
  if (clusterCoordinateDraft && Number.isFinite(clusterCoordinateDraft.latitude) && Number.isFinite(clusterCoordinateDraft.longitude)) {
    return clusterCoordinateDraft;
  }
  if (!activePhotoCluster) return null;
  return {
    latitude: Number(activePhotoCluster.latitude),
    longitude: Number(activePhotoCluster.longitude),
  };
}

function canEditActivePhotoClusterLocation() {
  if (!activePhotoCluster) return false;
  if (activePhotoCluster.isMergedDisplayCluster) return false;
  if ((activePhotoCluster.mergedClusterCount || 1) > 1) return false;
  return true;
}

function canEditActivePhotoClusterCoordinates() {
  if (!activePhotoCluster) return false;
  if (activePhotoCluster.isMergedDisplayCluster) return false;
  if ((activePhotoCluster.mergedClusterCount || 1) > 1) return false;
  if (activePhotoCluster.ruleId || activePhotoCluster.clusterType === 'single_rule') return false;
  return Number.isFinite(Number(activePhotoCluster.latitude)) && Number.isFinite(Number(activePhotoCluster.longitude));
}

function buildCoordinatePinMarkup(sizeClass = 'coordinate-pin-icon--button') {
  return `<span class="coordinate-pin-icon ${sizeClass}" aria-hidden="true"></span>`;
}

function createCoordinatePinMarkerIcon(size = 28) {
  return {
    content: `<div class="coordinate-pin-marker-wrap">${buildCoordinatePinMarkup('coordinate-pin-icon--map')}</div>`,
    size: new naver.maps.Size(size, size),
    anchor: new naver.maps.Point(size / 2, size - 2),
  };
}

function startClusterCoordinateEdit() {
  if (!map || !activePhotoCluster || !canEditActivePhotoClusterCoordinates()) return;
  isEditingClusterCoordinate = true;
  isSavingClusterCoordinate = false;
  clusterCoordinateDraft = {
    latitude: Number(activePhotoCluster.latitude),
    longitude: Number(activePhotoCluster.longitude),
  };
  clearClusterCoordinateMarker();
  clusterCoordinateMarker = new naver.maps.Marker({
    map,
    position: toLatLng(createLatLngLiteral(clusterCoordinateDraft.latitude, clusterCoordinateDraft.longitude)),
    draggable: true,
    animation: naver.maps.Animation.DROP,
    icon: createCoordinatePinMarkerIcon(),
  });
  naver.maps.Event.addListener(clusterCoordinateMarker, 'dragend', (event) => {
    clusterCoordinateDraft = {
      latitude: Number(event.coord.y),
      longitude: Number(event.coord.x),
    };
    renderPhotoPanelSubtitle();
  });
  map.panTo(toLatLng(createLatLngLiteral(clusterCoordinateDraft.latitude, clusterCoordinateDraft.longitude)));
  renderPhotoPanelSubtitle();
  if (photoPanelStatus) photoPanelStatus.textContent = '핀을 드래그한 뒤 저장을 누르면 이 최소 클러스터의 좌표를 바꿉니다.';
}

function stopClusterCoordinateEdit({ keepStatus = true } = {}) {
  isEditingClusterCoordinate = false;
  isSavingClusterCoordinate = false;
  clusterCoordinateDraft = null;
  clearClusterCoordinateMarker();
  renderPhotoPanelSubtitle();
  if (!keepStatus && photoPanelStatus) photoPanelStatus.textContent = '마커를 선택하면 사진이 표시됩니다.';
}

async function saveClusterCoordinateEdit() {
  if (!activePhotoCluster || !canEditActivePhotoClusterCoordinates()) return;
  const draft = getActiveClusterCoordinateDraft();
  if (!draft) return;

  isSavingClusterCoordinate = true;
  renderPhotoPanelSubtitle();
  if (photoPanelStatus) photoPanelStatus.textContent = '클러스터 좌표를 저장하는 중입니다...';

  try {
    const result = await fetchJson('/api/clusters/coordinates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        latitude: activePhotoCluster.latitude,
        longitude: activePhotoCluster.longitude,
        precision: activePhotoCluster.precision || 5,
        isMergedDisplayCluster: activePhotoCluster.isMergedDisplayCluster === true,
        mergedClusterCount: activePhotoCluster.mergedClusterCount || 1,
        ruleId: activePhotoCluster.ruleId || '',
        nextLatitude: draft.latitude,
        nextLongitude: draft.longitude,
      }),
    });

    const reopenedCluster = {
      ...activePhotoCluster,
      latitude: result.latitude,
      longitude: result.longitude,
      precision: result.precision || activePhotoCluster.precision || 5,
    };

    stopClusterCoordinateEdit();
    await openPhotoPanelForCluster(reopenedCluster);
    if (photoPanelStatus) photoPanelStatus.textContent = `${result.updatedCount || 0}개 사진의 좌표를 변경했습니다.`;
    refreshClustersNow().catch((error) => console.error(error));
  } catch (error) {
    isSavingClusterCoordinate = false;
    renderPhotoPanelSubtitle();
    if (photoPanelStatus) photoPanelStatus.textContent = error.message || '클러스터 좌표를 저장하지 못했습니다.';
  }
}

async function mergeSelectedClusters() {
  if (selectedMergeClusters.size < 2) {
    alert('병합할 최소 클러스터를 2개 이상 선택해 주세요.');
    return;
  }

  const defaultName = `병합 클러스터 ${new Date().toLocaleString('ko-KR')}`;
  const name = window.prompt('병합 그룹 이름', defaultName);
  if (name == null) return;

  const sources = [...selectedMergeClusters.values()];
  if (photoPanelStatus) photoPanelStatus.textContent = `선택한 ${sources.length}개 클러스터를 병합하는 중입니다...`;

  const result = await fetchJson('/api/clusters/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, sources }),
  });

  clearSelectedMergeClusters();
  resetPhotoPanel();
  await refreshClustersNow();
  if (photoPanelStatus) {
    photoPanelStatus.textContent = result.cacheAction === 'seeded'
      ? `클러스터 ${result.mergedSourceCount || sources.length}개를 병합했고 캐시도 이어받았습니다.`
      : `클러스터 ${result.mergedSourceCount || sources.length}개를 병합했고 캐시는 재계산되도록 정리했습니다.`;
  }
  alert(`병합 완료: ${result.group?.name || name}`);
}

function parseClusterLocationInput(value) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return { state: '', city: '' };

  const parts = normalized.split(' ');
  if (parts.length === 1) {
    if (activePhotoCluster?.state) return { state: activePhotoCluster.state, city: parts[0] };
    return { state: '', city: parts[0] };
  }

  return {
    state: parts[0],
    city: parts.slice(1).join(' '),
  };
}

function renderPhotoPanelSubtitle() {
  if (!photoPanelSubtitle) return;
  photoPanelSubtitle.innerHTML = '';

  if (!activePhotoCluster) {
    photoPanelSubtitle.textContent = '';
    return;
  }

  const canEditLocation = canEditActivePhotoClusterLocation();
  const canEditCoordinates = canEditActivePhotoClusterCoordinates();
  const wrap = document.createElement('div');
  wrap.className = 'photo-panel-meta';

  if (isEditingPhotoLocation && canEditLocation) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'photo-panel-location-input';
    input.value = formatClusterLocation(activePhotoCluster);
    input.placeholder = '예: 강원특별자치도 속초시';
    input.disabled = isSavingPhotoLocation;
    wrap.appendChild(input);
    input.focus();
    input.select();

    input.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const nextLocation = parseClusterLocationInput(input.value);
        isSavingPhotoLocation = true;
        input.disabled = true;
        if (photoPanelStatus) photoPanelStatus.textContent = '위치 정보를 저장하는 중입니다...';
        try {
          const result = await fetchJson('/api/clusters/location', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ruleId: activePhotoCluster.ruleId || '',
              latitude: activePhotoCluster.latitude,
              longitude: activePhotoCluster.longitude,
              precision: activePhotoCluster.precision || 5,
              isMergedDisplayCluster: activePhotoCluster.isMergedDisplayCluster === true,
              mergedClusterCount: activePhotoCluster.mergedClusterCount || 1,
              state: nextLocation.state,
              city: nextLocation.city,
            }),
          });
          activePhotoCluster.state = result.state || '';
          activePhotoCluster.city = result.city || '';
          isEditingPhotoLocation = false;
          isSavingPhotoLocation = false;
          renderPhotoPanelSubtitle();
          if (photoPanelStatus) photoPanelStatus.textContent = `${result.updatedCount || 0}개 사진의 위치 정보를 반영했습니다.`;
          refreshClustersNow().catch((error) => console.error(error));
        } catch (error) {
          isSavingPhotoLocation = false;
          input.disabled = false;
          if (photoPanelStatus) photoPanelStatus.textContent = error.message || '위치 정보를 저장하지 못했습니다.';
          input.focus();
          input.select();
        }
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        isEditingPhotoLocation = false;
        isSavingPhotoLocation = false;
        renderPhotoPanelSubtitle();
      }
    });

    input.addEventListener('blur', () => {
      if (isSavingPhotoLocation) return;
      isEditingPhotoLocation = false;
      renderPhotoPanelSubtitle();
    }, { once: true });
  } else {
    const text = document.createElement('div');
    text.className = canEditLocation ? 'photo-panel-location-text is-editable' : 'photo-panel-location-text';
    text.textContent = formatClusterLocation(activePhotoCluster) || '위치 정보 없음';

    if (canEditLocation) {
      text.setAttribute('role', 'button');
      text.setAttribute('tabindex', '0');
      text.addEventListener('click', () => {
        isEditingPhotoLocation = true;
        renderPhotoPanelSubtitle();
      });
      text.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        isEditingPhotoLocation = true;
        renderPhotoPanelSubtitle();
      });
    }

    wrap.appendChild(text);
  }

  const draft = getActiveClusterCoordinateDraft();
  const coordinateRow = document.createElement('div');
  coordinateRow.className = 'photo-panel-coordinate-row';

  if (canEditCoordinates && !isEditingClusterCoordinate) {
    const moveButton = document.createElement('button');
    moveButton.type = 'button';
    moveButton.className = 'photo-panel-coordinate-trigger';
    moveButton.innerHTML = buildCoordinatePinMarkup();
    moveButton.setAttribute('aria-label', '좌표 변경');
    moveButton.setAttribute('title', '좌표 변경');
    moveButton.addEventListener('click', () => {
      startClusterCoordinateEdit();
    });
    coordinateRow.appendChild(moveButton);
  }

  const coordinateText = document.createElement('div');
  coordinateText.className = 'photo-panel-coordinate-text';
  coordinateText.textContent = `${formatCoordinateValue(draft?.latitude)} , ${formatCoordinateValue(draft?.longitude)}`;
  coordinateRow.appendChild(coordinateText);
  wrap.appendChild(coordinateRow);

  if (canEditCoordinates && isEditingClusterCoordinate) {
    const actions = document.createElement('div');
    actions.className = 'photo-panel-inline-actions';

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'photo-panel-inline-button primary';
    saveButton.textContent = isSavingClusterCoordinate ? '저장 중...' : '좌표 저장';
    saveButton.disabled = isSavingClusterCoordinate;
    saveButton.addEventListener('click', () => {
      saveClusterCoordinateEdit().catch((error) => console.error(error));
    });
    actions.appendChild(saveButton);

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'photo-panel-inline-button';
    cancelButton.textContent = '취소';
    cancelButton.disabled = isSavingClusterCoordinate;
    cancelButton.addEventListener('click', () => {
      stopClusterCoordinateEdit({ keepStatus: true });
      if (photoPanelStatus) photoPanelStatus.textContent = '좌표 변경을 취소했습니다.';
    });
    actions.appendChild(cancelButton);

    wrap.appendChild(actions);
  }

  photoPanelSubtitle.appendChild(wrap);
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
  isEditingPhotoLocation = false;
  isSavingPhotoLocation = false;
  isEditingClusterCoordinate = false;
  isSavingClusterCoordinate = false;
  clusterCoordinateDraft = null;
  clearClusterCoordinateMarker();
  clearOverlay(selectedPhotoMarker);
  selectedPhotoMarker = null;
  if (photoPanelTitle) photoPanelTitle.textContent = '사진';
  renderPhotoPanelSubtitle();
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
    link.href = asset.previewUrl || '#';
    link.dataset.assetId = asset.assetId;
    if (asset.previewUrl) {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        openPhotoLightbox(asset);
      });
    } else {
      link.classList.add('is-unavailable');
      link.setAttribute('aria-disabled', 'true');
      link.addEventListener('click', (event) => {
        event.preventDefault();
      });
    }

    if (asset.thumbnailUrl || asset.previewUrl) {
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
      if (image && !asset.thumbnailUrl && asset.previewUrl) {
        image.addEventListener('error', () => {
          link.classList.add('is-unavailable');
          link.innerHTML = `<div class="photo-card-fallback">${asset.originalFileName || '미리보기 없음'}</div>`;
        }, { once: true });
      }
    } else {
      link.classList.add('is-unavailable');
      link.innerHTML = `<div class="photo-card-fallback">${asset.originalFileName || '미리보기 없음'}</div>`;
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
  clearClusterCoordinateMarker();
  photoPanelList?.classList.add('is-swapping');
  isEditingPhotoLocation = false;
  isSavingPhotoLocation = false;
  isEditingClusterCoordinate = false;
  isSavingClusterCoordinate = false;
  clusterCoordinateDraft = null;
  if (photoPanelTitle) {
    const displayName = getClusterDisplayName(cluster);
    photoPanelTitle.textContent = displayName ? `${displayName} · 사진 ${cluster.assetCount}장` : `사진 ${cluster.assetCount}장`;
  }
  renderPhotoPanelSubtitle();
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

function updateEditorModeUi() {
  const isEditing = Boolean(editingRuleId);
  if (ruleModalTitle) ruleModalTitle.textContent = isEditing ? '규칙 수정' : '규칙 추가';
  if (ruleModalHint) {
    ruleModalHint.textContent = isEditing
      ? '지도에서 폴리곤을 수정한 뒤 이 모달에서 저장하세요.'
      : '폴리곤 완료 후 규칙 정보를 저장하세요.';
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

function updateMapCursor() {
  document.body.classList.toggle('is-drawing-polygon', drawMode === 'polygon');
}

function updatePolygonToolButton() {
  const active = drawMode === 'polygon' || Boolean(editingRuleId);
  startPolygonButton?.classList.toggle('is-active', active);
  if (!startPolygonButton) return;
  startPolygonButton.textContent = active ? '✕' : '⬠';
  startPolygonButton.title = active ? '폴리곤/편집 취소' : '폴리곤 그리기';
  startPolygonButton.setAttribute('aria-label', active ? '폴리곤/편집 취소' : '폴리곤 그리기');
}

function cancelPolygonOrEditMode() {
  drawMode = null;
  resetDraft();
  cancelEditing(false);
  setRuleModalOpen(false);
  updateMapCursor();
  updatePolygonToolButton();
}

function setDrawMode(mode) {
  drawMode = mode;
  updateMapCursor();
  resetDraft();
  cancelEditing();
  setRuleModalOpen(false);
  updatePolygonToolButton();
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
  updateEditorModeUi();
  updatePolygonToolButton();
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
  updateEditorModeUi();
  updatePolygonToolButton();
  map.fitBounds(createPolygonBounds(path), { top: 20, right: 20, bottom: 20, left: 20 });
  setPreviewOutput(`편집 시작: ${rule.name}\n먼저 polygon을 수정한 뒤 완료(✓)를 누르면 규칙 수정 창이 열립니다.`);
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
  setRuleModalOpen(false);
  resetPhotoPanel();
  await Promise.all([loadRules(), refreshClustersNow()]);
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
  await refreshClustersNow();
  setPreviewOutput(JSON.stringify(result, null, 2));
}

async function previewRuleById(ruleId) {
  const result = await fetchJson(`/api/rules/${ruleId}/preview`, { method: 'POST' });
  setPreviewOutput(JSON.stringify(result, null, 2));
  alert(`미리보기: ${result.rule?.name || 'rule'}\n매칭 사진 ${result.assetCount || 0}장`);
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
    setRuleModalOpen(false);
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
  root.querySelector('[data-action="close"]')?.addEventListener('click', () => {
    closeRuleInfoWindow();
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
  const currentRule = getRuleById(rule.id) || rule;
  if (!ruleInfoWindow) {
    ruleInfoWindow = new naver.maps.InfoWindow({
      borderWidth: 0,
      backgroundColor: 'transparent',
      disableAnchor: false,
      pixelOffset: new naver.maps.Point(0, -8),
    });
  }

  const content = `
    <div class="rule-popup" data-rule-id="${currentRule.id}">
      <div class="rule-popup-header">
        <strong>${currentRule.name}</strong>
        <button type="button" class="popup-icon-button popup-close-button" data-action="close" aria-label="닫기" title="닫기">✕</button>
      </div>
      <div>사진 ${currentRule.assetCount != null ? currentRule.assetCount : '계산 중'}${currentRule.assetCount != null ? '장' : ''}</div>
      <div>${currentRule.state || ''} ${currentRule.city || ''}</div>
      <div class="popup-actions">
        <button type="button" class="popup-icon-button" data-action="edit" aria-label="수정" title="수정">✎</button>
        <button type="button" class="popup-icon-button" data-action="delete" aria-label="삭제" title="삭제">🗑</button>
      </div>
    </div>
  `;

  ruleInfoWindow.setContent(content);
  ruleInfoWindow.setPosition(position);
  ruleInfoWindow.open(map);
  window.setTimeout(() => bindRuleInfoWindowActions(currentRule), 0);
}

function sortRules(rules) {
  return [...rules].sort((a, b) => {
    const aHasCount = Number.isFinite(a.assetCount);
    const bHasCount = Number.isFinite(b.assetCount);
    if (aHasCount && bHasCount) {
      return (b.assetCount - a.assetCount) || (a.priority - b.priority) || String(a.name).localeCompare(String(b.name), 'ko');
    }
    if (aHasCount !== bHasCount) return aHasCount ? -1 : 1;
    return (a.priority - b.priority) || String(a.name).localeCompare(String(b.name), 'ko');
  });
}

function renderRuleOverlays(rules) {
  closeRuleInfoWindow();
  clearOverlayList(ruleOverlays);

  rules.forEach((rule) => {
    if (rule.geometry?.type !== 'Polygon') return;
    const path = geometryToPath(rule.geometry);
    const polygon = createRulePolygon(path, rule);
    ruleOverlays.push(polygon);
    naver.maps.Event.addListener(polygon, 'click', (event) => {
      const position = event?.coord || createPolygonBounds(path).getCenter();
      openRuleInfoWindow(getRuleById(rule.id) || rule, position);
    });
  });
}

function renderRuleList(rules) {
  const list = document.getElementById('rule-list');
  list.innerHTML = '';

  rules.forEach((rule) => {
    const item = document.createElement('li');
    item.className = 'rule-item rule-item-clickable';
    item.innerHTML = `
      <div class="rule-item-top">
        <div class="rule-item-title-wrap">
          <strong>${rule.name}</strong>
          <div class="rule-location">${rule.state || ''} ${rule.city || ''}</div>
        </div>
        <div class="rule-item-top-right">
          <span class="rule-count">${rule.assetCount != null ? `${rule.assetCount}장` : '…'}</span>
        </div>
      </div>
    `;
    list.appendChild(item);

    item.addEventListener('click', () => {
      resetPhotoPanel();
      if (isMobileLayout()) setMobilePanelOpen(false);
      startEditingRule(rule.id);
    });
  });
}

function renderRules(rules, { refreshOverlays = false } = {}) {
  currentRules = sortRules(rules);
  renderRuleList(currentRules);
  if (refreshOverlays) renderRuleOverlays(currentRules);
}

async function loadRuleCounts() {
  const requestSeq = ++ruleCountRequestSeq;
  const data = await fetchJson('/api/rules/counts');
  if (requestSeq !== ruleCountRequestSeq) return;

  const countMap = new Map(data.counts.map((item) => [item.id, Number(item.assetCount) || 0]));
  currentRules = currentRules.map((rule) => ({
    ...rule,
    assetCount: countMap.has(rule.id) ? countMap.get(rule.id) : null,
  }));
  renderRules(currentRules, { refreshOverlays: false });
}

function getClusterMarkerSize(cluster) {
  const count = Math.max(1, Number(cluster.assetCount) || 1);
  if (count <= 1) return 14;
  if (count <= 3) return 16;
  if (count <= 10) return 18;
  if (count <= 30) return 22;
  if (count <= 100) return 26;
  if (count <= 300) return 32;
  if (count <= 1000) return 38;
  return 44;
}

function buildDisplayClusters(clusters) {
  const zoom = map?.getZoom?.() || 7;
  return window.GeoSyncDisplayClustering.buildDisplayClusters(clusters, zoom);
}

function getClusterMarkerClassName(cluster) {
  const classes = ['cluster-marker'];
  if (cluster.isMergedDisplayCluster) classes.push('is-merged');
  if (cluster.ruleId || cluster.clusterType === 'single_rule') classes.push('is-rule');
  if (cluster.clusterType === 'manual_group') classes.push('is-manual-group');
  if (cluster.assetCount === 1) classes.push('is-single');
  if (isClusterSelectedForMerge(cluster)) classes.push('is-selected');
  return classes.join(' ');
}

function buildClusterMarkerIcon(cluster) {
  const size = getClusterMarkerSize(cluster);
  const className = getClusterMarkerClassName(cluster);
  const countLabel = Number(cluster.assetCount) > 10
    ? `<span class="cluster-marker-count">${cluster.assetCount > 999 ? '999+' : cluster.assetCount}</span>`
    : '';
  const badge = cluster.clusterType === 'manual_group'
    ? '<span class="cluster-marker-badge" aria-hidden="true">🔗</span>'
    : '';
  return {
    content: `<div class="${className}" style="width:${size}px;height:${size}px;"><div class="cluster-marker-inner"></div>${countLabel}${badge}</div>`,
    size: new naver.maps.Size(size, size),
    anchor: new naver.maps.Point(size / 2, size / 2),
  };
}

function getClusterRenderSignature(cluster) {
  return [
    cluster.latitude,
    cluster.longitude,
    cluster.assetCount,
    cluster.clusterType || '',
    cluster.ruleId || '',
    cluster.groupId || '',
    isClusterSelectedForMerge(cluster) ? 'selected' : '',
  ].join('|');
}

function createClusterMarker(cluster) {
  const marker = new naver.maps.Marker({
    map,
    position: toLatLng(createLatLngLiteral(cluster.latitude, cluster.longitude)),
    icon: buildClusterMarkerIcon(cluster),
  });
  marker.__cluster = cluster;
  marker.__signature = getClusterRenderSignature(cluster);
  naver.maps.Event.addListener(marker, 'click', () => {
    if (drawMode === 'polygon') return;
    const activeCluster = marker.__cluster || cluster;
    if (isSelectingClustersForMerge) {
      if (!toggleMergeClusterSelection(activeCluster) && photoPanelStatus) {
        photoPanelStatus.textContent = '최소 좌표 클러스터만 병합 대상으로 선택할 수 있습니다.';
      }
      return;
    }
    const target = toLatLng(createLatLngLiteral(activeCluster.latitude, activeCluster.longitude));
    map.panTo(target);
    openPhotoPanelForCluster(activeCluster).catch((error) => {
      console.error(error);
      if (photoPanelStatus) photoPanelStatus.textContent = error.message || '사진을 불러오지 못했습니다.';
    });
  });
  return marker;
}

function clearClusterOverlays() {
  for (const marker of clusterOverlays.values()) {
    clearOverlay(marker);
  }
  clusterOverlays.clear();
}

function resetClusterRenderState() {
  clusterRequestController?.abort();
  clusterRequestController = null;
  clearClusterOverlays();
  latestClusterRenderSeq = 0;
  clusterRequestSeq = 0;
}

function refreshClustersNow() {
  resetClusterRenderState();
  return loadClusters();
}

function renderClusters(clusters) {
  lastLoadedClusters = Array.isArray(clusters) ? clusters : [];
  const displayClusters = buildDisplayClusters(clusters);
  const nextKeys = new Set();

  displayClusters.forEach((cluster) => {
    const key = cluster.clusterKey || `${cluster.latitude}_${cluster.longitude}_${cluster.assetCount}_${cluster.ruleId || ''}`;
    nextKeys.add(key);

    const existingMarker = clusterOverlays.get(key);
    const nextSignature = getClusterRenderSignature(cluster);

    if (existingMarker) {
      existingMarker.__cluster = cluster;
      if (existingMarker.__signature !== nextSignature) {
        existingMarker.setPosition(toLatLng(createLatLngLiteral(cluster.latitude, cluster.longitude)));
        existingMarker.setIcon(buildClusterMarkerIcon(cluster));
        existingMarker.__signature = nextSignature;
      }
      return;
    }

    clusterOverlays.set(key, createClusterMarker(cluster));
  });

  for (const [key, marker] of clusterOverlays.entries()) {
    if (nextKeys.has(key)) continue;
    clearOverlay(marker);
    clusterOverlays.delete(key);
  }
}

async function fetchJson(url, options) {
  let res = await fetch(url, attachAdminToken(options));
  if (res.status === 401) {
    const input = window.prompt('관리자 토큰을 입력해 주세요.');
    if (input && input.trim()) {
      setAdminToken(input.trim());
      res = await fetch(url, attachAdminToken(options));
    }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '요청 실패');
  return data;
}

function setRestartConfirmModalOpen(open) {
  restartConfirmModal?.classList.toggle('is-open', open);
  restartConfirmModal?.setAttribute('aria-hidden', open ? 'false' : 'true');
}

function closeRestartConfirmModal() {
  setRestartConfirmModalOpen(false);
  restartModalOnApprove = null;
  if (restartConfirmApproveButton) restartConfirmApproveButton.disabled = false;
}

function openRestartConfirmModal({ title, message, approveLabel, onApprove }) {
  restartModalOnApprove = onApprove;
  if (restartConfirmTitle) restartConfirmTitle.textContent = title || '재시작 확인';
  if (restartConfirmMessage) restartConfirmMessage.textContent = message || '재시작을 진행하시겠습니까?';
  if (restartConfirmApproveButton) {
    restartConfirmApproveButton.textContent = approveLabel || '재시작';
    restartConfirmApproveButton.disabled = false;
  }
  setRestartConfirmModalOpen(true);
}

function scrollWorkerLogsToLatest() {
  if (!workerLogs) return;
  workerLogs.scrollTop = workerLogs.scrollHeight;
}

function setWorkerAutoRefresh(enabled) {
  workerAutoRefreshEnabled = enabled;
  if (workerAutoRefreshTimer) {
    clearInterval(workerAutoRefreshTimer);
    workerAutoRefreshTimer = null;
  }
  if (autoRefreshWorkerButton) {
    autoRefreshWorkerButton.classList.toggle('is-active', enabled);
    autoRefreshWorkerButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    autoRefreshWorkerButton.textContent = enabled ? '자동 새로고침 켜짐' : '자동 새로고침';
  }
  if (!enabled) return;
  workerAutoRefreshTimer = setInterval(() => {
    loadWorkerSnapshot({ showLoading: false }).catch((error) => {
      console.error(error);
      setWorkerAutoRefresh(false);
      if (workerStatus) workerStatus.textContent = error.message || '워커 상태를 불러오지 못했습니다.';
    });
  }, 10000);
}

async function copyWorkerLogs() {
  const text = latestWorkerLogText || workerLogs?.textContent || '';
  if (!text.trim()) return;
  await navigator.clipboard.writeText(text);
}

async function downloadWorkerLogs() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let res = await fetch(`/api/admin/worker/logs/download?logLimit=500&tz=${encodeURIComponent(DISPLAY_TIME_ZONE)}`, attachAdminToken());
  if (res.status === 401) {
    const input = window.prompt('관리자 토큰을 입력해 주세요.');
    if (input && input.trim()) {
      setAdminToken(input.trim());
      res = await fetch(`/api/admin/worker/logs/download?logLimit=500&tz=${encodeURIComponent(DISPLAY_TIME_ZONE)}`, attachAdminToken());
    }
  }
  if (!res.ok) throw new Error('로그 다운로드에 실패했습니다.');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `immich-geosync-worker-${stamp}.log`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderWorkerSnapshot(snapshot) {
  if (workerStatus) {
    workerStatus.innerHTML = '';
    appendKeyValueRow(workerStatus, 'worker-status-row', '상태', snapshot.state?.status || 'unknown');
    appendKeyValueRow(workerStatus, 'worker-status-row', '최근 갱신', formatShortDateTime(snapshot.state?.updatedAt));
    appendKeyValueRow(workerStatus, 'worker-status-row', '작동 주기', snapshot.state?.intervalHours ? `${snapshot.state.intervalHours}시간` : '');
    appendKeyValueRow(workerStatus, 'worker-status-row', '건물명', snapshot.state?.appendBuildingName === true ? '사용' : '미사용');
    const config = snapshot.state?.config || {};
    appendKeyValueRow(workerStatus, 'worker-status-row', '클러스터 반경', config.clusterRadiusMeters ? `${config.clusterRadiusMeters}m` : '');
  }

  if (workerRuns) {
    workerRuns.innerHTML = '';
    (snapshot.runs || []).slice(0, 4).forEach((run) => {
      const summary = run.summary || {};
      const parts = [
        `${formatShortDateTime(run.startedAt)} ${run.status}`,
        Number.isFinite(Number(summary.totalUpdated)) ? `반영 ${summary.totalUpdated}건` : '',
        run.error ? `오류 ${run.error}` : '',
      ].filter(Boolean).join(' · ');
      appendKeyValueRow(workerRuns, 'worker-run-row', run.forceUpdate ? '수동 실행' : '정기 실행', parts);
    });
  }

  if (workerLogs) {
    latestWorkerLogText = (snapshot.logs || [])
      .map((log) => `${String(log.level || 'info').toUpperCase()} ${log.message}`)
      .join('\n') || '아직 저장된 워커 로그가 없습니다.';
    workerLogs.textContent = latestWorkerLogText;
    requestAnimationFrame(scrollWorkerLogsToLatest);
  }
}

async function loadWorkerSnapshot({ showLoading = true } = {}) {
  if (showLoading && workerStatus) workerStatus.textContent = '워커 상태를 불러오는 중입니다.';
  renderWorkerSnapshot(await fetchJson('/api/admin/worker?logLimit=160'));
}

async function restartServices(target) {
  const label = target === 'all' ? '전체' : '워커';
  if (workerStatus) workerStatus.textContent = `${label} 재시작 요청 중...`;
  restartWorkerButton && (restartWorkerButton.disabled = true);
  restartAllButton && (restartAllButton.disabled = true);
  saveSettingsButton && (saveSettingsButton.disabled = true);
  try {
    await fetchJson('/api/admin/restart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target }),
    });
    if (workerStatus) workerStatus.textContent = `${label} 재시작 요청 완료. 상태를 다시 불러옵니다.`;
    await loadWorkerSnapshot({ showLoading: false });
  } finally {
    restartWorkerButton && (restartWorkerButton.disabled = false);
    restartAllButton && (restartAllButton.disabled = false);
    saveSettingsButton && (saveSettingsButton.disabled = false);
  }
}

function renderSettings(settingsPayload) {
  if (!settingsForm) return;
  settingsForm.innerHTML = '';
  (settingsPayload.settings || []).forEach((setting) => {
    const label = document.createElement('label');
    label.className = 'settings-field';
    label.dataset.key = setting.key;

    const title = document.createElement('span');
    title.textContent = setting.label || setting.key;
    label.appendChild(title);

    let input;
    if (setting.type === 'boolean') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = /^(1|true|yes|on)$/i.test(String(setting.value || ''));
    } else {
      input = document.createElement('input');
      input.type = setting.type === 'number' ? 'number' : 'text';
      input.value = setting.secret ? '' : (setting.value || '');
      if (setting.secret) input.placeholder = setting.isSet ? '변경할 때만 새 값 입력' : '값 없음';
    }
    input.dataset.key = setting.key;
    input.dataset.type = setting.type;
    label.appendChild(input);

    if (setting.secret || setting.displayValue) {
      const hint = document.createElement('small');
      hint.textContent = setting.secret ? `현재값: ${setting.displayValue || '없음'}` : setting.key;
      label.appendChild(hint);
    }

    settingsForm.appendChild(label);
  });

  if (settingsStatus) settingsStatus.textContent = `설정 파일: ${settingsPayload.path || '/app/.env'}`;
}

async function loadSettings() {
  if (settingsStatus) settingsStatus.textContent = '환경 설정을 불러오는 중입니다.';
  renderSettings(await fetchJson('/api/admin/settings'));
}

function formatUpdatedAt(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('ko-KR');
}

function renderCacheCityOptions(cities = []) {
  if (!cacheFilterCitySelect) return;
  const current = cacheFilterCitySelect.value || '';
  cacheFilterCitySelect.innerHTML = '<option value="">전체</option>';
  (Array.isArray(cities) ? cities : []).forEach((city) => {
    const option = document.createElement('option');
    option.value = city;
    option.textContent = city;
    cacheFilterCitySelect.appendChild(option);
  });
  cacheFilterCitySelect.value = current && cities.includes(current) ? current : '';
}

function renderCacheStateOptions(states = []) {
  if (!cacheFilterStateSelect) return;
  const current = cacheFilterStateSelect.value || '';
  cacheFilterStateSelect.innerHTML = '<option value="">전체</option>';
  (Array.isArray(states) ? states : []).forEach((state) => {
    const option = document.createElement('option');
    option.value = state;
    option.textContent = state;
    cacheFilterStateSelect.appendChild(option);
  });
  cacheFilterStateSelect.value = current && states.includes(current) ? current : '';
}

function renderCachePagination() {
  if (!cachePagination) return;
  cachePagination.innerHTML = '';
  const totalPages = Math.max(1, Number(cacheTotalPages) || 1);
  const current = Math.max(1, Math.min(totalPages, Number(cachePage) || 1));
  const windowSize = 9;
  const half = Math.floor(windowSize / 2);
  let start = Math.max(1, current - half);
  let end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);

  const makeButton = (label, targetPage, active = false, disabled = false) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cache-page-button';
    if (active) button.classList.add('is-active');
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener('click', () => {
      cachePage = targetPage;
      loadClusterCacheList().catch((error) => {
        console.error(error);
        if (cacheStatus) cacheStatus.textContent = error.message || '캐시 목록을 불러오지 못했습니다.';
      });
    });
    return button;
  };

  cachePagination.appendChild(makeButton('«', 1, false, current === 1));
  cachePagination.appendChild(makeButton('‹', Math.max(1, current - 1), false, current === 1));
  for (let page = start; page <= end; page += 1) {
    cachePagination.appendChild(makeButton(String(page), page, page === current));
  }
  cachePagination.appendChild(makeButton('›', Math.min(totalPages, current + 1), false, current === totalPages));
  cachePagination.appendChild(makeButton('»', totalPages, false, current === totalPages));
}

function renderClusterCacheList(caches = []) {
  if (!cacheTableBody) return;
  cacheTableBody.innerHTML = '';

  if (!Array.isArray(caches) || !caches.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.className = 'muted';
    td.textContent = '캐시 데이터가 없습니다.';
    tr.appendChild(td);
    cacheTableBody.appendChild(tr);
    return;
  }

  const fragment = document.createDocumentFragment();
  caches.forEach((item) => {
    const tr = document.createElement('tr');

    const keyTd = document.createElement('td');
    const keyCode = document.createElement('code');
    keyCode.textContent = item.cacheKey || '';
    keyTd.appendChild(keyCode);
    tr.appendChild(keyTd);

    const stateTd = document.createElement('td');
    const stateInput = document.createElement('input');
    stateInput.type = 'text';
    stateInput.value = item.state || '';
    stateTd.appendChild(stateInput);
    tr.appendChild(stateTd);

    const cityTd = document.createElement('td');
    const cityInput = document.createElement('input');
    cityInput.type = 'text';
    cityInput.value = item.city || '';
    cityTd.appendChild(cityInput);
    tr.appendChild(cityTd);

    const statusTd = document.createElement('td');
    const statusInput = document.createElement('input');
    statusInput.type = 'text';
    statusInput.value = item.status || '';
    statusTd.appendChild(statusInput);
    tr.appendChild(statusTd);

    const failureTd = document.createElement('td');
    const failureInput = document.createElement('input');
    failureInput.type = 'text';
    failureInput.value = item.failureReason || '';
    failureTd.appendChild(failureInput);
    tr.appendChild(failureTd);

    const updatedTd = document.createElement('td');
    updatedTd.textContent = formatUpdatedAt(item.updatedAt);
    tr.appendChild(updatedTd);

    const actionTd = document.createElement('td');
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'cache-save-button';
    saveButton.textContent = '저장';
    saveButton.addEventListener('click', async () => {
      saveButton.disabled = true;
      saveButton.textContent = '저장 중...';
      try {
        const updated = await fetchJson(`/api/clusters/cache/${encodeURIComponent(item.cacheKey || '')}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state: stateInput.value,
            city: cityInput.value,
            status: statusInput.value,
            failureReason: failureInput.value,
          }),
        });
        updatedTd.textContent = formatUpdatedAt(updated.updatedAt);
        if (cacheStatus) cacheStatus.textContent = `저장 완료: ${updated.cacheKey}`;
      } catch (error) {
        if (cacheStatus) cacheStatus.textContent = error.message || '캐시 저장에 실패했습니다.';
      } finally {
        saveButton.disabled = false;
        saveButton.textContent = '저장';
      }
    });
    actionTd.appendChild(saveButton);
    tr.appendChild(actionTd);
    fragment.appendChild(tr);
  });

  cacheTableBody.appendChild(fragment);
}

async function loadClusterCacheList() {
  if (cacheStatus) cacheStatus.textContent = '캐시 목록을 불러오는 중입니다.';
  const params = new URLSearchParams();
  params.set('page', String(cachePage));
  params.set('pageSize', String(cachePageSize));
  if (cacheFilterStateSelect?.value) params.set('state', cacheFilterStateSelect.value);
  if (cacheFilterCitySelect?.value) params.set('city', cacheFilterCitySelect.value);
  const data = await fetchJson(`/api/clusters/cache?${params.toString()}`);
  renderClusterCacheList(data.caches || []);
  cacheTotalPages = Number(data.pagination?.totalPages || 1);
  cachePage = Number(data.pagination?.page || cachePage);
  renderCachePagination();
  if (cacheStatus) {
    cacheStatus.textContent = `총 ${Number(data.pagination?.total || 0)}개 캐시 · ${cachePage}/${cacheTotalPages} 페이지`;
  }
}

async function loadCacheStates() {
  const data = await fetchJson('/api/clusters/cache/filter/states');
  renderCacheStateOptions(data.states || []);
}

async function loadCacheCities() {
  const state = cacheFilterStateSelect?.value || '';
  if (!state) {
    renderCacheCityOptions([]);
    return;
  }
  const data = await fetchJson(`/api/clusters/cache/filter/cities?state=${encodeURIComponent(state)}`);
  renderCacheCityOptions(data.cities || []);
}

async function saveSettings() {
  if (!settingsForm) return;
  const settings = {};
  settingsForm.querySelectorAll('input[data-key]').forEach((input) => {
    settings[input.dataset.key] = input.type === 'checkbox' ? (input.checked ? 'true' : 'false') : input.value;
  });
  if (settingsStatus) settingsStatus.textContent = '환경 설정을 저장하는 중입니다.';
  renderSettings(await fetchJson('/api/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  }));
  if (settingsStatus) settingsStatus.textContent = '저장했습니다. 재시작을 하면 새 설정이 즉시 반영됩니다.';
  openRestartConfirmModal({
    title: '설정 저장 완료',
    message: '저장을 완료했습니다. 지금 재시작하시겠습니까?',
    approveLabel: '전체 재시작',
    onApprove: async () => {
      await restartServices('all');
      if (settingsStatus) settingsStatus.textContent = '전체 재시작을 요청했습니다.';
    },
  });
}

async function loadRules() {
  const data = await fetchJson('/api/rules');
  renderRules(data.rules, { refreshOverlays: true });
  loadRuleCounts().catch((error) => {
    console.error(error);
  });
}

async function loadClusters() {
  if (!map) return;
  clusterRequestController?.abort();
  const requestController = new AbortController();
  clusterRequestController = requestController;
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
  let data;
  try {
    data = await fetchJson(`/api/clusters?${params.toString()}`, {
      signal: requestController.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') return;
    throw error;
  } finally {
    if (clusterRequestController === requestController) clusterRequestController = null;
  }
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
  setRuleModalOpen(false);
  await loadRules();
  alert('rule이 저장되었습니다.');
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
  navButtons.forEach((button) => {
    button.addEventListener('click', () => setActiveView(button.dataset.viewTarget || 'map'));
  });
  document.getElementById('start-polygon').addEventListener('click', () => {
    if (drawMode === 'polygon' || editingRuleId) {
      cancelPolygonOrEditMode();
      return;
    }
    setDrawMode('polygon');
  });
  document.getElementById('clear-shape').addEventListener('click', () => resetDraft());
  document.getElementById('finish-shape').addEventListener('click', () => {
    if (editingRuleId) {
      const geometry = getEditingGeometry();
      if (!geometry) {
        alert('완성된 도형이 없습니다.');
        return;
      }
      updateEditorModeUi();
      setRuleModalOpen(true);
      return;
    }

    const geometry = getDraftGeometry();
    if (!geometry) {
      alert('완성된 도형이 없습니다.');
      return;
    }
    autofillAddressFromGeometry(geometry)
      .then(() => {
        updateEditorModeUi();
        setRuleModalOpen(true);
      })
      .catch((error) => {
        console.error(error);
        setPreviewOutput(`주소 자동 채우기 실패: ${error.message}`);
        alert(`도형은 준비되었지만 주소 자동 채우기에 실패했습니다.\n${error.message}`);
        updateEditorModeUi();
        setRuleModalOpen(true);
      });
  });
  document.getElementById('refresh-rules').addEventListener('click', loadRules);
  refreshWorkerButton?.addEventListener('click', () => loadWorkerSnapshot().catch((error) => {
    console.error(error);
    if (workerStatus) workerStatus.textContent = error.message || '워커 상태를 불러오지 못했습니다.';
  }));
  restartWorkerButton?.addEventListener('click', () => {
    openRestartConfirmModal({
      title: '워커 재시작',
      message: 'immich-geosync-worker만 재시작합니다. 진행하시겠습니까?',
      approveLabel: '워커 재시작',
      onApprove: async () => {
        await restartServices('worker');
      },
    });
  });
  restartAllButton?.addEventListener('click', () => {
    openRestartConfirmModal({
      title: '전체 재시작',
      message: 'worker + admin 전체를 재시작합니다. 진행하시겠습니까?',
      approveLabel: '전체 재시작',
      onApprove: async () => {
        await restartServices('all');
      },
    });
  });
  autoRefreshWorkerButton?.addEventListener('click', () => {
    setWorkerAutoRefresh(!workerAutoRefreshEnabled);
  });
  copyWorkerLogsButton?.addEventListener('click', () => copyWorkerLogs().catch((error) => {
    console.error(error);
    alert(`로그 복사 실패: ${error.message}`);
  }));
  downloadWorkerLogsButton?.addEventListener('click', () => downloadWorkerLogs().catch((error) => {
    console.error(error);
    alert(`로그 다운로드 실패: ${error.message}`);
  }));
  saveSettingsButton?.addEventListener('click', () => saveSettings().catch((error) => {
    console.error(error);
    if (settingsStatus) settingsStatus.textContent = error.message || '환경 설정을 저장하지 못했습니다.';
  }));
  restartConfirmCloseButton?.addEventListener('click', closeRestartConfirmModal);
  restartConfirmCancelButton?.addEventListener('click', closeRestartConfirmModal);
  restartConfirmBackdrop?.addEventListener('click', closeRestartConfirmModal);
  restartConfirmApproveButton?.addEventListener('click', async () => {
    if (!restartModalOnApprove) {
      closeRestartConfirmModal();
      return;
    }
    restartConfirmApproveButton.disabled = true;
    try {
      await restartModalOnApprove();
      closeRestartConfirmModal();
    } catch (error) {
      console.error(error);
      const message = error?.message || '재시작 요청에 실패했습니다.';
      if (settingsStatus) settingsStatus.textContent = message;
      if (workerStatus) workerStatus.textContent = message;
      alert(message);
      restartConfirmApproveButton.disabled = false;
    }
  });
  refreshCacheButton?.addEventListener('click', () => loadClusterCacheList().catch((error) => {
    console.error(error);
    if (cacheStatus) cacheStatus.textContent = error.message || '캐시 목록을 불러오지 못했습니다.';
  }));
  cacheFilterStateSelect?.addEventListener('change', () => {
    cachePage = 1;
    loadCacheCities().then(() => loadClusterCacheList()).catch((error) => {
      console.error(error);
      if (cacheStatus) cacheStatus.textContent = error.message || '캐시 목록을 불러오지 못했습니다.';
    });
  });
  cacheFilterCitySelect?.addEventListener('change', () => {
    cachePage = 1;
    loadClusterCacheList().catch((error) => {
      console.error(error);
      if (cacheStatus) cacheStatus.textContent = error.message || '캐시 목록을 불러오지 못했습니다.';
    });
  });
  cachePageSizeSelect?.addEventListener('change', () => {
    cachePageSize = Number(cachePageSizeSelect.value || 100);
    cachePage = 1;
    loadClusterCacheList().catch((error) => {
      console.error(error);
      if (cacheStatus) cacheStatus.textContent = error.message || '캐시 목록을 불러오지 못했습니다.';
    });
  });
  document.getElementById('refresh-clusters').addEventListener('click', () => refreshClustersNow().catch((error) => {
    console.error(error);
  }));
  toggleMergeClustersButton?.addEventListener('click', () => {
    const next = !isSelectingClustersForMerge;
    if (next) {
      cancelPolygonOrEditMode();
      resetPhotoPanel();
      isSelectingClustersForMerge = true;
      selectedMergeClusters.clear();
      updateMergeClusterButtons();
      refreshClusterMarkerIcons();
      if (photoPanelStatus) photoPanelStatus.textContent = '병합할 최소 좌표 클러스터를 클릭해 선택하세요.';
      return;
    }
    clearSelectedMergeClusters();
    if (photoPanelStatus) photoPanelStatus.textContent = '클러스터 병합 선택을 종료했습니다.';
  });
  applyMergeClustersButton?.addEventListener('click', () => {
    mergeSelectedClusters().catch((error) => {
      console.error(error);
      if (photoPanelStatus) photoPanelStatus.textContent = error.message || '클러스터 병합에 실패했습니다.';
      alert(error.message || '클러스터 병합에 실패했습니다.');
    });
  });
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
    if (event.key === 'Escape') {
      if (ruleModal?.classList.contains('is-open')) {
        closeRuleModal();
        return;
      }
      if (isEditingClusterCoordinate) {
        stopClusterCoordinateEdit({ keepStatus: true });
        if (photoPanelStatus) photoPanelStatus.textContent = '좌표 변경을 취소했습니다.';
        return;
      }
      if (isSelectingClustersForMerge) {
        clearSelectedMergeClusters();
        if (photoPanelStatus) photoPanelStatus.textContent = '클러스터 병합 선택을 종료했습니다.';
        return;
      }
      closePhotoLightbox();
    }
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
  ruleModalCloseButton?.addEventListener('click', () => {
    closeRuleModal();
  });
  ruleModalCancelButton?.addEventListener('click', () => {
    closeRuleModal();
  });
  ruleModalBackdrop?.addEventListener('click', () => {
    closeRuleModal();
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
  updateMapCursor();
  updatePolygonToolButton();
  updateMergeClusterButtons();
  setMobilePanelOpen(false);
  resetPhotoPanel();
  bindUiEvents();
  await loadNaverMapsScript();
  initializeMap();
  await Promise.all([loadRules(), refreshClustersNow(), loadWorkerSnapshot(), loadSettings(), loadCacheStates()]);
  await loadCacheCities();
  await loadClusterCacheList();
}

init().catch((error) => {
  console.error(error);
  alert(error.message);
});
