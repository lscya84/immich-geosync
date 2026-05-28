const { fetchVworldAddressDetailed } = require('./vworld');
const { buildRuleAddress } = require('./override-rules');

function normalizePolygonCoordinates(geometry) {
  return Array.isArray(geometry?.coordinates)
    ? geometry.coordinates.filter((pair) => Array.isArray(pair) && pair.length >= 2)
    : [];
}

function getPolygonCentroid(geometry) {
  const coordinates = normalizePolygonCoordinates(geometry);
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
    const avgLon = points.reduce((sum, [lon]) => sum + Number(lon), 0) / points.length;
    const avgLat = points.reduce((sum, [, lat]) => sum + Number(lat), 0) / points.length;
    return Number.isFinite(avgLat) && Number.isFinite(avgLon) ? { lat: avgLat, lon: avgLon } : null;
  }

  const factor = areaFactor * 3;
  return {
    lat: centroidLat / factor,
    lon: centroidLon / factor,
  };
}

function extractBuildingName(text) {
  const value = String(text || '').trim();
  if (!value) return '';

  const bracketMatch = value.match(/\(([^()]+)\)\s*$/);
  if (bracketMatch?.[1]) return bracketMatch[1].trim();

  const tokens = value.split(/\s+/).filter(Boolean);
  const candidate = tokens[tokens.length - 1] || '';
  if (/(아파트|오피스텔|타워|센터|시티|빌딩|프라자|플라자|하우스|캐슬|팰리스|파크|뷰|타운)$/u.test(candidate)) {
    return candidate;
  }

  return '';
}

async function buildClusterRuleAddress(rule, config, options = {}) {
  const manualAddress = buildRuleAddress(rule);

  if (rule?.geometry?.type !== 'Polygon' || rule?.treatAsSingleCluster !== true) {
    return manualAddress;
  }

  const fallbackCity = String(options.fallbackCity || '').trim();
  const fallbackState = String(options.fallbackState || '').trim();
  const centroid = getPolygonCentroid(rule.geometry);

  let derivedState = manualAddress.state || fallbackState;
  let source = 'override-single-cluster-manual';

  if (centroid && config?.vworldKey) {
    const vworldResult = await fetchVworldAddressDetailed(centroid.lat, centroid.lon, config);
    if (vworldResult.address?.state) {
      derivedState = String(vworldResult.address.state).trim() || derivedState;
      source = 'override-single-cluster-vworld';
    }
  }

  const explicitBuilding = String(rule?.building || '').trim()
    || extractBuildingName(manualAddress.city);
  const fallbackBuilding = manualAddress.city
    ? ''
    : extractBuildingName(fallbackCity);
  const derivedBuilding = explicitBuilding || fallbackBuilding;

  return {
    country: manualAddress.country,
    state: derivedState,
    city: manualAddress.city || derivedBuilding || fallbackCity,
    building: derivedBuilding,
    source,
  };
}

module.exports = {
  getPolygonCentroid,
  extractBuildingName,
  buildClusterRuleAddress,
};
