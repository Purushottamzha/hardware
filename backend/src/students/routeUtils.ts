export interface LatLng {
  lat: number;
  lon: number;
}

export interface Waypoint extends LatLng {}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function crossTrackDistance(
  point: LatLng,
  segStart: LatLng,
  segEnd: LatLng,
): { distance: number; alongTrack: number } {
  const R = 6371000;

  const d13 = haversine(point.lat, point.lon, segStart.lat, segStart.lon) / R;
  const theta13 = bearing(segStart.lat, segStart.lon, point.lat, point.lon);
  const theta12 = bearing(segStart.lat, segStart.lon, segEnd.lat, segEnd.lon);

  const dXt = Math.asin(Math.sin(d13) * Math.sin(theta13 - theta12)) * R;
  const dAt = Math.acos(Math.cos(d13) / Math.cos(dXt / R)) * R;

  return { distance: Math.abs(dXt), alongTrack: isNaN(dAt) ? 0 : dAt };
}

function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return Math.atan2(y, x);
}

function segmentLength(segStart: LatLng, segEnd: LatLng): number {
  return haversine(segStart.lat, segStart.lon, segEnd.lat, segEnd.lon);
}

export function distanceToRoute(point: LatLng, waypoints: Waypoint[]): number {
  if (waypoints.length < 2) {
    if (waypoints.length === 1) return haversine(point.lat, point.lon, waypoints[0].lat, waypoints[0].lon);
    return Infinity;
  }

  let minDist = Infinity;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];

    const segLen = segmentLength(a, b);
    if (segLen < 0.01) continue;

    const { distance } = crossTrackDistance(point, a, b);
    if (distance < minDist) minDist = distance;
  }

  const startDist = haversine(point.lat, point.lon, waypoints[0].lat, waypoints[0].lon);
  const endDist = haversine(point.lat, point.lon, waypoints[waypoints.length - 1].lat, waypoints[waypoints.length - 1].lon);
  minDist = Math.min(minDist, startDist, endDist);

  return minDist;
}

export function suggestRoutesForPoint(
  point: LatLng,
  allRoutes: { id: string; name: string; waypoints: Waypoint[] }[],
  thresholdMeters = 500,
): { id: string; name: string; distance: number }[] {
  return allRoutes
    .map((r) => ({ id: r.id, name: r.name, distance: distanceToRoute(point, r.waypoints) }))
    .filter((r) => r.distance <= thresholdMeters)
    .sort((a, b) => a.distance - b.distance);
}

export function projectOntoRoute(point: LatLng, waypoints: Waypoint[]): number {
  if (waypoints.length < 2) {
    if (waypoints.length === 1) return haversine(point.lat, point.lon, waypoints[0].lat, waypoints[0].lon);
    return 0;
  }

  let cumulative = 0;
  let minTotal = Infinity;
  let bestAlongTrack = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];

    const segLen = segmentLength(a, b);
    if (segLen < 0.01) continue;

    const { distance, alongTrack } = crossTrackDistance(point, a, b);

    let distAlong;
    if (alongTrack <= 0) {
      distAlong = haversine(point.lat, point.lon, a.lat, a.lon);
    } else if (alongTrack >= segLen) {
      distAlong = haversine(point.lat, point.lon, b.lat, b.lon);
    } else {
      distAlong = distance;
    }

    const totalDist = cumulative + (alongTrack <= 0 ? 0 : alongTrack >= segLen ? segLen : alongTrack);

    if (totalDist < minTotal) {
      minTotal = totalDist;
      bestAlongTrack = cumulative + Math.max(0, Math.min(segLen, alongTrack));
    }

    cumulative += segLen;
  }

  return bestAlongTrack;
}
