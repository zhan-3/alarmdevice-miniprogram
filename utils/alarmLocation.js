// Hardware gpsLng/gpsLat remain WGS-84. Only the backend's explicit GCJ-02 projection is map-ready.
// Do not convert here or fall back to raw coordinates when talking to an older backend.
function getAlarmMapLocation(item) {
  const location = item && item.displayLocation;
  if (!location || location.coordinateSystem !== 'gcj02') return null;
  const { longitude, latitude } = location;
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
      typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90) return null;
  return { longitude, latitude, coordinateSystem: 'gcj02' };
}

module.exports = { getAlarmMapLocation };
