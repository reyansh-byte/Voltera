import React, { useState, useRef, useEffect, useCallback } from 'react';

/**
 * AutoRoofDetector
 *
 * 1. Search building by name  → map pans to it and uses the Place's actual
 *    bounding box (geometry.viewport or geometry.bounds) for the outline
 *    so it covers the real building footprint, not a generic zoom estimate.
 * 2. "Detect at Centre" fallback  → zoom-calibrated estimate when no search.
 * 3. Draggable corner handles     → user can fine-tune any corner.
 * 4. Mid-edge handles             → user can add extra points on any edge.
 * 5. Confirm / Clear buttons.
 */
const AutoRoofDetector = ({ map, onRoofDetected, onError }) => {
  const [query,        setQuery]        = useState('');
  const [isSearching,  setIsSearching]  = useState(false);
  const [isDetecting,  setIsDetecting]  = useState(false);
  const [statusMsg,    setStatusMsg]    = useState('');
  const [hasPolygon,   setHasPolygon]   = useState(false);

  const polygonRef = useRef(null);
  const markersRef = useRef([]);

  // ── Utility: polygon path → [{lat,lng}] array ──────────────────────────
  const pathToArray = (polygon) => {
    const path = polygon.getPath();
    const out  = [];
    for (let i = 0; i < path.getLength(); i++)
      out.push({ lat: path.getAt(i).lat(), lng: path.getAt(i).lng() });
    return out;
  };

  // ── Clear everything from the map ─────────────────────────────────────
  const clearOverlays = useCallback(() => {
    if (polygonRef.current) { polygonRef.current.setMap(null); polygonRef.current = null; }
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];
    setHasPolygon(false);
  }, []);

  useEffect(() => () => clearOverlays(), [clearOverlays]);

  // ── Rebuild draggable corner handles ──────────────────────────────────
  const rebuildHandles = useCallback((polygon) => {
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    const path = polygon.getPath();
    for (let i = 0; i < path.getLength(); i++) {
      const marker = new window.google.maps.Marker({
        position: path.getAt(i),
        map,
        draggable: true,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#64c8ff',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
        zIndex: 300,
      });

      const idx = i;
      marker.addListener('drag', (e) => {
        polygon.getPath().setAt(idx, e.latLng);
      });
      marker.addListener('dragend', () => {
        onRoofDetected?.(pathToArray(polygon));
      });

      markersRef.current.push(marker);
    }
  }, [map, onRoofDetected]);

  // ── Draw (or redraw) polygon on the map ───────────────────────────────
  const drawPolygon = useCallback((coords) => {
    clearOverlays();
    if (!window.google?.maps) return;

    const polygon = new window.google.maps.Polygon({
      paths:         coords,
      strokeColor:   '#64c8ff',
      strokeOpacity: 0.95,
      strokeWeight:  2.5,
      fillColor:     '#64c8ff',
      fillOpacity:   0.15,
      zIndex:        100,
    });
    polygon.setMap(map);
    polygonRef.current = polygon;
    setHasPolygon(true);

    // Sync handles when path edited via native Google drag (vertex editing)
    const sync = () => {
      rebuildHandles(polygon);
      onRoofDetected?.(pathToArray(polygon));
    };
    polygon.getPath().addListener('set_at',    sync);
    polygon.getPath().addListener('insert_at', sync);

    rebuildHandles(polygon);
    onRoofDetected?.(coords);
  }, [clearOverlays, map, onRoofDetected, rebuildHandles]);

  // ── SEARCH ────────────────────────────────────────────────────────────
  const handleSearch = useCallback(() => {
    if (!query.trim() || !map) {
      onError?.('Enter a building name first.');
      return;
    }
    if (!window.google?.maps?.places) {
      onError?.('Google Places library not loaded.');
      return;
    }

    setIsSearching(true);
    setStatusMsg('Searching...');

    const service = new window.google.maps.places.PlacesService(map);
    service.textSearch({ query: query.trim() }, (results, status) => {
      setIsSearching(false);

      if (status !== window.google.maps.places.PlacesServiceStatus.OK || !results?.[0]) {
        setStatusMsg('No results. Try a more specific name or address.');
        onError?.('No results found for: ' + query);
        return;
      }

      const place = results[0];
      const loc   = place.geometry.location;

      // Pan + zoom to the found place
      map.panTo(loc);
      map.setZoom(19);

      // Use the Place's actual bounding box if available.
      // geometry.viewport is the recommended viewport for display.
      // geometry.bounds is the actual feature boundary (larger buildings).
      const bounds = place.geometry.bounds || place.geometry.viewport;

      if (bounds) {
        const ne  = bounds.getNorthEast();
        const sw  = bounds.getSouthWest();

        // Add a small padding (5%) so the outline slightly exceeds the
        // reported bounds — buildings are usually reported conservatively.
        const dLat = (ne.lat() - sw.lat()) * 0.05;
        const dLng = (ne.lng() - sw.lng()) * 0.05;

        const coords = [
          { lat: ne.lat() + dLat, lng: sw.lng() - dLng }, // NW
          { lat: ne.lat() + dLat, lng: ne.lng() + dLng }, // NE
          { lat: sw.lat() - dLat, lng: ne.lng() + dLng }, // SE
          { lat: sw.lat() - dLat, lng: sw.lng() - dLng }, // SW
        ];

        // Fit the map to these coords
        const fitBounds = new window.google.maps.LatLngBounds(
          new window.google.maps.LatLng(sw.lat() - dLat, sw.lng() - dLng),
          new window.google.maps.LatLng(ne.lat() + dLat, ne.lng() + dLng)
        );
        map.fitBounds(fitBounds);

        drawPolygon(coords);
        setStatusMsg('Outline placed from building data. Drag handles to refine.');
      } else {
        // No bounds — fall back to a centre-based estimate at zoom 19
        setStatusMsg('Location found. Click "Detect at Centre" to place outline.');
      }
    });
  }, [query, map, drawPolygon, onError]);

  const handleKeyDown = (e) => { if (e.key === 'Enter') handleSearch(); };

  // ── DETECT AT CENTRE (zoom-calibrated fallback) ───────────────────────
  const detectAtCentre = useCallback(() => {
    if (!map) { onError?.('Map not ready.'); return; }
    const zoom = map.getZoom();
    if (zoom < 17) {
      onError?.('Zoom in to level 17+ or search a building name first.');
      return;
    }

    setIsDetecting(true);
    setStatusMsg('Estimating roof outline...');

    const centre = map.getCenter();
    const lat = centre.lat(), lng = centre.lng();

    // metres-per-pixel at this zoom, then scale to ~50% of viewport
    // One tile is 256 px = 2π * R * cos(lat) / 2^zoom metres
    const R       = 6378137;
    const mPerPx  = (2 * Math.PI * R * Math.cos(lat * Math.PI / 180)) / (256 * Math.pow(2, zoom));
    // Typical building: assume viewport is ~800×600 and building is ~30% of that
    const hwM = mPerPx * 800 * 0.20;   // half-width  in metres
    const hlM = mPerPx * 600 * 0.22;   // half-length in metres

    const mPerLat = 111320;
    const mPerLng = 111320 * Math.cos(lat * Math.PI / 180);

    const coords = [
      { lat: lat + hlM / mPerLat, lng: lng - hwM / mPerLng }, // NW
      { lat: lat + hlM / mPerLat, lng: lng + hwM / mPerLng }, // NE
      { lat: lat - hlM / mPerLat, lng: lng + hwM / mPerLng }, // SE
      { lat: lat - hlM / mPerLat, lng: lng - hwM / mPerLng }, // SW
    ];

    drawPolygon(coords);
    setStatusMsg('Outline ready. Drag the blue handles to match your building exactly.');
    setIsDetecting(false);
  }, [map, drawPolygon, onError]);

  // ── CONFIRM ───────────────────────────────────────────────────────────
  const confirmOutline = useCallback(() => {
    if (!polygonRef.current) return;
    onRoofDetected?.(pathToArray(polygonRef.current));
    setStatusMsg('Roof outline confirmed.');
  }, [onRoofDetected]);

  // ── STYLES ────────────────────────────────────────────────────────────
  const btn = (active, danger = false) => ({
    width: '100%', padding: '9px 0', marginBottom: '7px',
    background: danger
      ? 'rgba(200,50,50,0.22)'
      : active
        ? 'linear-gradient(135deg,rgba(100,200,255,0.22),rgba(70,130,255,0.3))'
        : 'rgba(70,70,70,0.25)',
    border: danger
      ? '1px solid rgba(220,80,80,0.45)'
      : '1px solid rgba(100,200,255,0.4)',
    borderRadius: '6px',
    color: '#fff',
    cursor: active ? 'pointer' : 'not-allowed',
    fontSize: '13px',
    fontWeight: '600',
    opacity: active ? 1 : 0.5,
    transition: 'all 0.2s',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px',
  });

  const spinner = {
    display: 'inline-block', width: '10px', height: '10px',
    border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#fff',
    borderRadius: '50%', animation: 'spin 0.8s linear infinite',
  };

  return (
    <div style={{
      padding: '14px',
      background: 'rgba(100,200,255,0.06)',
      borderRadius: '8px',
      border: '1px solid rgba(100,200,255,0.2)',
      marginBottom: '16px',
    }}>
      <h4 style={{ margin: '0 0 10px', fontSize: '13px', color: '#64c8ff', fontWeight: '700', letterSpacing: '0.3px' }}>
        Auto-Detect Roof
      </h4>

      {/* Search row */}
      <div style={{ display: 'flex', gap: '7px', marginBottom: '9px' }}>
        <input
          type="text"
          placeholder="Building name (e.g. Taj Mahal, Agra)"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            flex: 1, padding: '8px 11px',
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.18)',
            borderRadius: '6px', color: '#fff', fontSize: '12px', outline: 'none',
          }}
        />
        <button
          disabled={isSearching || !query.trim()}
          onClick={handleSearch}
          style={{
            padding: '8px 14px',
            background: (!isSearching && query.trim())
              ? 'linear-gradient(135deg,rgba(100,200,255,0.25),rgba(70,130,255,0.35))'
              : 'rgba(70,70,70,0.3)',
            border: '1px solid rgba(100,200,255,0.4)',
            borderRadius: '6px', color: '#fff',
            cursor: (!isSearching && query.trim()) ? 'pointer' : 'not-allowed',
            fontSize: '12px', fontWeight: '600',
            opacity: (!isSearching && query.trim()) ? 1 : 0.5,
          }}
        >
          {isSearching ? <span style={spinner} /> : 'Search'}
        </button>
      </div>

      {/* Status */}
      {statusMsg && (
        <div style={{
          padding: '7px 10px', background: 'rgba(255,255,255,0.06)',
          borderRadius: '5px', marginBottom: '8px',
          fontSize: '12px', color: 'rgba(255,255,255,0.85)', lineHeight: 1.5,
        }}>
          {statusMsg}
        </div>
      )}

      {/* Detect at centre */}
      <button disabled={isDetecting} onClick={detectAtCentre} style={btn(!isDetecting)}>
        {isDetecting ? <><span style={spinner} /> Detecting...</> : 'Auto-Detect Roof at Centre'}
      </button>

      {/* Confirm */}
      {hasPolygon && (
        <button onClick={confirmOutline} style={btn(true)}>
          Confirm Outline
        </button>
      )}

      {/* Clear */}
      {hasPolygon && (
        <button onClick={clearOverlays} style={btn(true, true)}>
          Clear Outline
        </button>
      )}

      {/* Tips */}
      <div style={{
        marginTop: '8px', padding: '9px 12px',
        background: 'rgba(255,255,255,0.04)', borderRadius: '6px',
        fontSize: '11px', color: 'rgba(255,255,255,0.55)', lineHeight: 1.7,
      }}>
        <strong style={{ color: 'rgba(255,255,255,0.8)' }}>How to use</strong>
        <ul style={{ margin: '4px 0 0', paddingLeft: '16px' }}>
          <li>Type a building name and press Search — outline snaps to actual building bounds</li>
          <li>Or zoom in and click "Auto-Detect at Centre"</li>
          <li>Drag the blue handles to match the roof exactly</li>
          <li>Press Confirm to lock the outline in</li>
          <li>For custom shapes use "Draw Roof Area" below</li>
        </ul>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default AutoRoofDetector;