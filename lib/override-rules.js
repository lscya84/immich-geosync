function isValidCoordinatePair(pair) {
  return Array.isArray(pair) && pair.length >= 2 && Number.isFinite(Number(pair[0])) && Number.isFinite(Number(pair[1]));
}

function pointInPolygon(lat, lon, coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 3) return false;

  let inside = false;
  for (let i = 0, j = coordinates.length - 1; i < coordinates.length; j = i++) {
    const current = coordinates[i];
    const previous = coordinates[j];
    if (!isValidCoordinatePair(current) || !isValidCoordinatePair(previous)) continue;

    const xi = Number(current[0]);
    const yi = Number(current[1]);
    const xj = Number(previous[0]);
    const yj = Number(previous[1]);

    const intersects = ((yi > lat) !== (yj > lat))
      && (lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi);

    if (intersects) inside = !inside;
  }

  return inside;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function matchesRule(lat, lon, rule) {
  if (!rule || rule.enabled === false || !rule.geometry) return false;
  const geometry = rule.geometry;

  if (geometry.type === 'Point') {
    const [ruleLon, ruleLat] = geometry.coordinates || [];
    const radiusMeters = Number(geometry.radiusMeters || 20);
    if (!Number.isFinite(ruleLat) || !Number.isFinite(ruleLon)) return false;
    return haversineMeters(lat, lon, Number(ruleLat), Number(ruleLon)) <= radiusMeters;
  }

  if (geometry.type === 'Polygon') {
    return pointInPolygon(lat, lon, geometry.coordinates || []);
  }

  return false;
}

function findMatchingRule(lat, lon, rules) {
  for (const rule of rules || []) {
    if (matchesRule(lat, lon, rule)) return rule;
  }
  return null;
}

function buildRuleAddress(rule) {
  const state = String(rule?.state || '').trim();
  const city = String(rule?.city || '').trim();
  const building = String(rule?.building || '').trim();
  return {
    country: String(rule?.country || '대한민국').trim() || '대한민국',
    state,
    city: building ? `${city}${city ? ' ' : ''}(${building})` : city,
    building,
    source: 'override',
  };
}

module.exports = {
  haversineMeters,
  matchesRule,
  findMatchingRule,
  buildRuleAddress,
};
