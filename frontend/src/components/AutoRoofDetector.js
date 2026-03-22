import React, { useState, useRef, useEffect, useCallback } from 'react';

/**
 * AutoRoofDetector
 *
 * 1. Search building by name  → snaps to actual building bounds via Places API.
 * 2. AI Detect (Claude Vision) → captures satellite map view, sends to Claude,
 *    which traces the rooftop polygon and returns normalised coordinates.
 * 3. Manual fallback           → zoom-calibrated rectangle estimate.
 * 4. Draggable corner handles  → user can refine any detected outline.
 * 5. Confirm / Clear buttons.
 */

// ── Capture the Google Maps satellite view as a base64 JPEG ────────────────
// Primary: /api/maps-static proxy (add this route to your Express server —
//   see comment below). Falls back to stitching visible map tiles.
//
// Backend route to add (Express):
//   app.get('/api/maps-static', async (req, res) => {
//     const {center,zoom,size,maptype,scale} = req.query;
//     const url = `https://maps.googleapis.com/maps/api/staticmap`
//       + `?center=${center}&zoom=${zoom}&size=${size}`
//       + `&maptype=${maptype}&scale=${scale}&key=${process.env.GOOGLE_MAPS_KEY}`;
//     const r = await fetch(url);
//     res.set('Content-Type','image/png');
//     r.body.pipe(res);
//   });
const captureMapImage = async (map) => {
  const centre = map.getCenter();
  const zoom   = map.getZoom();
  const lat    = centre.lat().toFixed(6);
  const lng    = centre.lng().toFixed(6);

  // Try proxy first
  try {
    const res = await fetch(
      `/api/maps-static?center=${lat},${lng}&zoom=${zoom}&size=640x640&maptype=satellite&scale=2`
    );
    if (res.ok) {
      const blob = await res.blob();
      return await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload  = () => resolve(r.result.split(',')[1]);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
    }
  } catch {}

  // Fallback: stitch map tile <img> elements from the live map div.
  // Each tile is a Google Maps tile image. We draw them all onto a canvas
  // positioned relative to the map container, then crop to 640×640.
  try {
    const mapDiv = map.getDiv();
    const mapRect = mapDiv.getBoundingClientRect();
    const W = Math.round(mapRect.width)  || 640;
    const H = Math.round(mapRect.height) || 640;

    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, W, H);

    // Collect all img elements inside the map and draw them
    const imgs = Array.from(mapDiv.querySelectorAll('img'));
    const draws = imgs.map(img => new Promise(res => {
      if (!img.src || img.src.startsWith('data:') || img.naturalWidth === 0) { res(); return; }
      // Get position of tile relative to map container
      const r = img.getBoundingClientRect();
      const x = r.left - mapRect.left;
      const y = r.top  - mapRect.top;
      const w = r.width  || img.naturalWidth;
      const h = r.height || img.naturalHeight;
      const tmp = new Image();
      tmp.crossOrigin = 'anonymous';
      tmp.onload  = () => { try { ctx.drawImage(tmp, x, y, w, h); } catch {} res(); };
      tmp.onerror = () => res();
      tmp.src = img.src;
    }));

    await Promise.allSettled(draws);

    // Crop/pad to 640×640 centred
    const out = document.createElement('canvas');
    out.width = out.height = 640;
    const ox = Math.max(0, (W - 640) / 2);
    const oy = Math.max(0, (H - 640) / 2);
    out.getContext('2d').drawImage(canvas, ox, oy, 640, 640, 0, 0, 640, 640);

    const dataUrl = out.toDataURL('image/jpeg', 0.92);
    if (!dataUrl || dataUrl === 'data:,') return null;
    return dataUrl.split(',')[1];
  } catch (err) {
    console.warn('Map capture failed:', err);
    return null;
  }
};

// ── Send satellite image to Claude Vision, get rooftop polygon back ────────
const detectRoofWithAI = async (base64Img, onProgress) => {
  onProgress?.('Sending satellite image to AI...');

  const prompt = `You are analysing a satellite/aerial map image to detect a building rooftop.

Your task:
1. Find the LARGEST or MOST CENTRAL building rooftop in the image.
2. Trace its outer boundary as a polygon.
3. Return normalised coordinates (0.0 = top/left edge, 1.0 = bottom/right edge of image).
4. 4–16 points, clockwise from the top-left corner of the roof.
5. Only trace the roof boundary — not surrounding ground, roads, or other structures.

Respond with ONLY this JSON, nothing else:
{"polygon":[{"x":0.3,"y":0.2},{"x":0.7,"y":0.2},{"x":0.7,"y":0.8},{"x":0.3,"y":0.8}],"confidence":0.85,"notes":""}

Rules:
- If no clear building is visible, return confidence 0 and an empty polygon [].
- polygon points must be strictly between 0.0 and 1.0.
- Clockwise winding from top-left corner of the roof.
- Output ONLY the JSON object. No markdown, no explanation.`;

  try {
    const response = await fetch('/api/anthropic/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Img } },
            { type: 'text',  text: prompt }
          ]
        }]
      })
    });

    if (!response.ok) throw new Error('Claude API error: ' + response.status);

    const data = await response.json();
    const raw  = data.content?.[0]?.text || '';

    // Robust JSON extraction
    let parsed = null;
    try { parsed = JSON.parse(raw.replace(/^```json\s*/i,'').replace(/```\s*$/i,'').trim()); }
    catch { try { const m = raw.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); } catch {} }

    if (!parsed || !parsed.polygon || parsed.polygon.length < 3 || parsed.confidence < 0.3) {
      return null;
    }
    return parsed;
  } catch (err) {
    console.error('AI roof detection error:', err);
    return null;
  }
};

const AutoRoofDetector = ({ map, onRoofDetected, onError }) => {
  const [query,        setQuery]        = useState('');
  const [isSearching,  setIsSearching]  = useState(false);
  const [isAIDetecting,setIsAIDetecting]= useState(false);
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

  // ── isDragging ref — prevents handle rebuild mid-drag ───────────────
  const isDraggingRef = useRef(false);

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

      // dragstart: flag so polygon path listener doesn't rebuild handles
      marker.addListener('dragstart', () => { isDraggingRef.current = true; });

      // drag: update polygon path to follow the marker smoothly
      marker.addListener('drag', (e) => {
        polygon.getPath().setAt(idx, e.latLng);
      });

      // dragend: unflag, move marker to final snapped position, notify parent
      marker.addListener('dragend', (e) => {
        isDraggingRef.current = false;
        polygon.getPath().setAt(idx, e.latLng);
        marker.setPosition(e.latLng);
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

    // Only rebuild handles when path changes from outside sources (not mid-drag)
    const sync = () => {
      if (isDraggingRef.current) return; // skip if a marker drag is in progress
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

  // ── AI DETECT — Claude Vision traces the rooftop ─────────────────────
  const detectWithAI = useCallback(async () => {
    if (!map) { onError?.('Map not ready.'); return; }
    const zoom = map.getZoom();
    if (zoom < 17) {
      onError?.('Zoom in to at least level 17 so the building fills the view.');
      return;
    }

    setIsAIDetecting(true);
    setStatusMsg('Capturing satellite view...');

    try {
      // Step 1: get satellite image
      const b64 = await captureMapImage(map);
      if (!b64) {
        setStatusMsg('Could not capture map image. Try the manual fallback below.');
        setIsAIDetecting(false);
        return;
      }

      // Step 2: ask Claude to trace the rooftop
      setStatusMsg('AI is analysing the rooftop...');
      const result = await detectRoofWithAI(b64, setStatusMsg);

      if (!result) {
        setStatusMsg('AI could not detect a roof. Try zooming in more or use the manual fallback.');
        setIsAIDetecting(false);
        return;
      }

      // Step 3: convert normalised image coords → lat/lng
      // The Static API image covers the same area as the live map viewport.
      // We compute the lat/lng bounds of the 640×640 image using the same
      // metres-per-pixel formula as the tile spec.
      const centre   = map.getCenter();
      const lat      = centre.lat();
      const lng      = centre.lng();
      const R        = 6378137;
      const mPerPx   = (2 * Math.PI * R * Math.cos(lat * Math.PI / 180)) / (256 * Math.pow(2, zoom));
      // Static image is 640px at scale=2 → 640 CSS px, but covers 640/2=320 tile px
      const imgPx    = 320; // tile pixels covered by the 640-wide image
      const halfM    = imgPx * mPerPx / 2;
      const mPerLat  = 111320;
      const mPerLng  = 111320 * Math.cos(lat * Math.PI / 180);

      // Image top-left corner in lat/lng
      const topLat   = lat + halfM / mPerLat;
      const leftLng  = lng - halfM / mPerLng;
      const spanLat  = (2 * halfM) / mPerLat;
      const spanLng  = (2 * halfM) / mPerLng;

      const coords = result.polygon.map(p => ({
        lat: topLat  - p.y * spanLat,
        lng: leftLng + p.x * spanLng,
      }));

      drawPolygon(coords);
      const conf = Math.round((result.confidence || 0) * 100);
      setStatusMsg(`AI detected rooftop (${conf}% confidence). Drag handles to refine.`);
    } catch (err) {
      console.error('AI detection error:', err);
      setStatusMsg('Detection failed. Use the manual fallback below.');
    }

    setIsAIDetecting(false);
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

      {/* AI Detect — primary action */}
      <button disabled={isAIDetecting} onClick={detectWithAI}
        style={{
          ...btn(!isAIDetecting),
          background: !isAIDetecting
            ? 'linear-gradient(135deg,rgba(100,200,255,0.25),rgba(70,100,255,0.38))'
            : 'rgba(70,70,70,0.25)',
          marginBottom: '7px',
        }}>
        {isAIDetecting
          ? <><span style={spinner} /> AI analysing rooftop...</>
          : 'AI Detect Roof (Claude Vision)'}
      </button>

      {/* Confirm */}
      {hasPolygon && (
        <button onClick={confirmOutline} style={btn(true)}>
          ✓ Confirm Outline
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
        <strong style={{ color: 'rgba(255,255,255,0.8)' }}>How it works</strong>
        <ul style={{ margin: '4px 0 0', paddingLeft: '16px' }}>
          <li>Search a building name — outline snaps to its actual bounds</li>
          <li>Or zoom in to level 17+ and click <strong style={{color:'rgba(255,255,255,0.8)'}}>AI Detect Roof</strong> — Claude Vision analyses the satellite view and traces the rooftop polygon</li>
          <li>Drag the blue handles to refine the detected outline</li>
          <li>Press Confirm to lock the outline in</li>
        </ul>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default AutoRoofDetector;