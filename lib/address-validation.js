const KOREAN_STATES = new Set([
  '서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시',
  '대전광역시', '울산광역시', '세종특별자치시', '경기도', '강원특별자치도',
  '충청북도', '충청남도', '전북특별자치도', '전라남도', '경상북도',
  '경상남도', '제주특별자치도',
]);

// Natural Earth 1:110m, public domain. Coastal tolerance handles its generalized shoreline.
const SOUTH_KOREA_MAINLAND_RING = [
  [126.174759, 37.749686], [126.237339, 37.840378], [126.68372, 37.804773],
  [127.073309, 38.256115], [127.780035, 38.304536], [128.205746, 38.370397],
  [128.349716, 38.612243], [129.21292, 37.432392], [129.46045, 36.784189],
  [129.468304, 35.632141], [129.091377, 35.082484], [128.18585, 34.890377],
  [127.386519, 34.475674], [126.485748, 34.390046], [126.37392, 34.93456],
  [126.559231, 35.684541], [126.117398, 36.725485], [126.860143, 36.893924],
  [126.174759, 37.749686],
];
const SOUTH_KOREA_ISLAND_BOUNDS = [
  { south: 32.95, north: 33.65, west: 126.05, east: 127.05 }, // Jeju
  { south: 37.75, north: 38.15, west: 124.45, east: 124.85 }, // Baengnyeong/West Sea islands
  { south: 37.40, north: 37.60, west: 130.75, east: 131.00 }, // Ulleungdo
  { south: 37.20, north: 37.30, west: 131.80, east: 131.95 }, // Dokdo
];

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeAdministrativeKey(address) {
  const state = normalizeText(address?.state);
  const city = normalizeText(address?.city).replace(/\s*\([^()]*\)\s*$/, '');
  return `${state}|${city}`;
}

function isSouthKoreanAddress(address) {
  const country = normalizeText(address?.country);
  const state = normalizeText(address?.state);
  return ['대한민국', 'South Korea', 'Korea'].includes(country) && KOREAN_STATES.has(state);
}

function pointInRing(latitude, longitude, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = ((yi > latitude) !== (yj > latitude))
      && (longitude < ((xj - xi) * (latitude - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function distanceToSegmentMeters(latitude, longitude, start, end) {
  const referenceLatitude = 36 * Math.PI / 180;
  const scaleX = 111320 * Math.cos(referenceLatitude);
  const scaleY = 110540;
  const px = (longitude - start[0]) * scaleX;
  const py = (latitude - start[1]) * scaleY;
  const dx = (end[0] - start[0]) * scaleX;
  const dy = (end[1] - start[1]) * scaleY;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0;
  return Math.hypot(px - t * dx, py - t * dy);
}

function isWithinSouthKoreaBoundary(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (SOUTH_KOREA_ISLAND_BOUNDS.some((bounds) =>
    lat >= bounds.south && lat <= bounds.north && lon >= bounds.west && lon <= bounds.east)) return true;
  if (pointInRing(lat, lon, SOUTH_KOREA_MAINLAND_RING)) return true;

  let coastDistance = Infinity;
  for (let i = 1; i < SOUTH_KOREA_MAINLAND_RING.length; i += 1) {
    coastDistance = Math.min(coastDistance, distanceToSegmentMeters(
      lat, lon, SOUTH_KOREA_MAINLAND_RING[i - 1], SOUTH_KOREA_MAINLAND_RING[i]));
  }
  return coastDistance <= 30000;
}

function compareProviderAddresses(vworld, naver) {
  if (!vworld || !naver) return null;
  return normalizeAdministrativeKey(vworld) === normalizeAdministrativeKey(naver);
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const radius = 6371000;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(Number(lat2) - Number(lat1));
  const longitudeDelta = toRadians(Number(lon2) - Number(lon1));
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(Number(lat1))) * Math.cos(toRadians(Number(lat2)))
      * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(a));
}

function getBoundaryValidationPoints(cluster, minimumSpanMeters = 10) {
  const unique = [...new Map((cluster?.points || []).map((point) => [
    `${Number(point.latitude)}:${Number(point.longitude)}`,
    { latitude: Number(point.latitude), longitude: Number(point.longitude) },
  ])).values()].filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));

  if (unique.length < 2) return [];
  const candidates = [
    unique.reduce((a, b) => (a.latitude <= b.latitude ? a : b)),
    unique.reduce((a, b) => (a.latitude >= b.latitude ? a : b)),
    unique.reduce((a, b) => (a.longitude <= b.longitude ? a : b)),
    unique.reduce((a, b) => (a.longitude >= b.longitude ? a : b)),
  ];
  const points = [...new Map(candidates.map((point) => [`${point.latitude}:${point.longitude}`, point])).values()];
  let maximumSpan = 0;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      maximumSpan = Math.max(maximumSpan, haversineMeters(
        points[i].latitude, points[i].longitude, points[j].latitude, points[j].longitude));
    }
  }
  if (maximumSpan < Math.max(0, Number(minimumSpanMeters) || 0)) return [];

  return points.filter((point) =>
    point.latitude !== Number(cluster.centroidLat) || point.longitude !== Number(cluster.centroidLon));
}

module.exports = {
  normalizeAdministrativeKey,
  isSouthKoreanAddress,
  isWithinSouthKoreaBoundary,
  compareProviderAddresses,
  getBoundaryValidationPoints,
};
