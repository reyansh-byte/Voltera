import React, { useState, useRef, useEffect, useCallback } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// CLAUDE VISION — pure image recognition, no OCR, no pixel analysis
//
// Sends the blueprint image to Claude and asks it to:
//   1. Identify the roof outline as normalised polygon points (0–1 range)
//   2. Extract all building metadata (dimensions, roof type, pitch, etc.)
//   3. Identify obstacle positions (chimneys, vents, skylights)
// ─────────────────────────────────────────────────────────────────────────────
// Simple in-memory cache — avoids re-analysing the same image in one session
const _analysisCache = new Map();

const analyseBlueprint = async (imageBase64, mimeType, onProgress) => {
  // Use first 200 chars of base64 as cache key (fast, good enough for dedup)
  const cacheKey = imageBase64.slice(0, 200);
  if (_analysisCache.has(cacheKey)) {
    console.log('[BlueprintTracer] Using cached analysis result');
    onProgress(100);
    return _analysisCache.get(cacheKey);
  }

  onProgress(10);

  const prompt = `You are a roof plan analyser. Analyse this architectural roof plan image and return a single JSON object.

Rules:
- roofPolygon: trace the OUTER boundary of the roof/building only (ignore title blocks on the right, watermarks, interior lines). Points are normalised fractions of image width/height (0.0–1.0). Clockwise from top-left. 4–12 points.
- dimensions: read from dimension lines/annotations in feet. Estimate 30–80ft if unclear.
- roofPitch: look for triangle symbols e.g. "5:12". Default "5:12" if not visible.
- roofType: gable|hip|flat|shed|complex
- roofShape: rectangle|L-shape|T-shape|irregular
- obstacles: array of {type,x,y,widthFraction,heightFraction} for chimneys/vents/skylights

Respond with ONLY this JSON, nothing else:
{"roofPolygon":[{"x":0.1,"y":0.1},{"x":0.7,"y":0.1},{"x":0.7,"y":0.8},{"x":0.1,"y":0.8}],"dimensions":{"width":40,"length":60},"roofPitch":"5:12","roofType":"hip","roofShape":"L-shape","buildingType":"residential","wallHeight":10,"storeys":1,"orientation":"unknown","chimneys":0,"skylights":0,"vents":0,"obstacles":[],"confidence":0.8,"notes":""}

IMPORTANT: Output ONLY the JSON object. No markdown. No explanation. Start with { end with }.`;

  onProgress(20);

  // Upscale small images and boost contrast so Claude can read faint lines clearly
  let finalB64  = imageBase64;
  let finalMime = 'image/jpeg';
  try {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res; img.onerror = rej;
      img.src = `data:${mimeType};base64,${imageBase64}`;
    });
    // Target 1600px on longest side — upscale small blueprints, downscale large photos
    const TARGET = 1600;
    const scale = Math.min(4, TARGET / Math.max(img.width, img.height)); // cap 4× upscale
    const c = document.createElement('canvas');
    c.width  = Math.round(img.width  * scale);
    c.height = Math.round(img.height * scale);
    const ctx = c.getContext('2d');
    // Boost contrast for faint blueprint lines
    ctx.filter = 'contrast(1.4) brightness(1.1)';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    finalB64  = c.toDataURL('image/jpeg', 0.92).split(',')[1];
    finalMime = 'image/jpeg';
    console.log(`Blueprint resized: ${img.width}×${img.height} → ${c.width}×${c.height} (scale ${scale.toFixed(2)}×)`);
  } catch (e) {
    console.warn('Image resize skipped:', e.message);
  }

  try {
    // Call the local backend proxy — avoids browser CORS restrictions.
    // The proxy at /api/anthropic/messages forwards to api.anthropic.com
    // and injects the API key server-side.
    const response = await fetch('/api/anthropic/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: finalMime, data: finalB64 }
            },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    onProgress(65);

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Claude API error:', response.status, errBody);
      return null;
    }

    const data = await response.json();
    const raw  = data.content?.[0]?.text || '';
    console.log('Raw AI response:', raw); // ← helps debug malformed JSON

    // Robustly extract JSON — Gemini sometimes wraps in markdown or adds commentary
    let parsed = null;
    try {
      // Strategy 1: strip markdown fences and parse directly
      const stripped = raw
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      parsed = JSON.parse(stripped);
    } catch {
      try {
        // Strategy 2: find the first { ... } block in the response
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      } catch {
        try {
          // Strategy 3: extract just the JSON lines (remove comment lines)
          const jsonOnly = raw
            .split('\n')
            .filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('#'))
            .join('\n');
          const match2 = jsonOnly.match(/\{[\s\S]*\}/);
          if (match2) parsed = JSON.parse(match2[0]);
        } catch (e3) {
          console.error('All JSON parse strategies failed:', e3.message);
          console.error('Raw response was:', raw);
          return null;
        }
      }
    }

    if (!parsed) {
      console.error('Could not extract JSON from response:', raw);
      return null;
    }

    onProgress(90);
    console.log('Claude Vision result:', parsed);
    // Cache so re-renders / re-analyses of same image skip the API call
    _analysisCache.set(cacheKey, parsed);
    return parsed;

  } catch (err) {
    console.error('Claude Vision error:', err);
    return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Convert Claude result to the data shape the rest of the app expects
// ─────────────────────────────────────────────────────────────────────────────
const toAppData = (r, canvasW, canvasH) => {
  const pitchStr = (r.roofPitch && String(r.roofPitch).includes(':'))
    ? String(r.roofPitch).trim()
    : '5:12';
  const [rise, run] = pitchStr.split(':').map(Number);
  const pitchRatio  = (rise && run) ? rise / run : 0.4167;

  let wallH = r.wallHeight ? Number(r.wallHeight) : null;
  if (!wallH) wallH = (r.storeys >= 2) ? 20 : 10;

  const w = r.dimensions?.width  || 40;
  const l = r.dimensions?.length || 60;

  // Normalised polygon → canvas pixel points
  const canvasPoints = (r.roofPolygon || []).map(p => ({
    x: p.x * canvasW,
    y: p.y * canvasH,
  }));

  // Normalised polygon → feet (for 3D)
  const realPoints = (r.roofPolygon || []).map(p => ({
    x: p.x * w,
    y: p.y * l,
  }));

  const chimneys  = Array.from({ length: Math.min(r.chimneys  || 0, 4) }, () => ({ type: 'standard' }));
  const skylights = Array.from({ length: Math.min(r.skylights || 0, 6) }, () => ({ width: 3, length: 4 }));
  const vents     = Array.from({ length: Math.min(r.vents     || 0, 6) }, () => ({}));

  return {
    canvasPoints,
    polygon:           realPoints,
    dimensions:        { width: w, length: l, unit: 'feet' },
    roofPitch:         pitchRatio,
    roofPitchNotation: pitchStr,
    roofType:          (r.roofType     || 'gable').toLowerCase(),
    roofShape:         (r.roofShape    || 'rectangle').toLowerCase(),
    buildingType:      (r.buildingType || 'residential').toLowerCase(),
    wallHeight:        wallH,
    storeys:           r.storeys || 1,
    orientation:       r.orientation || 'unknown',
    features:          { chimneys, skylights, vents, dormers: [] },
    obstaclePositions: (r.obstacles || []).map(o => ({
      ...o,
      px: o.x * canvasW,
      py: o.y * canvasH,
      pw: (o.widthFraction  || 0.04) * canvasW,
      ph: (o.heightFraction || 0.04) * canvasH,
    })),
    confidence: r.confidence || 0,
    notes:      r.notes || '',
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// DRAW — renders blueprint image with detected polygon + obstacle overlay
// ─────────────────────────────────────────────────────────────────────────────
const drawOverlay = (canvas, img, appData, hoveredPt, draggingIdx) => {
  if (!canvas || !img) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const pts = appData?.canvasPoints || [];
  if (pts.length < 2) return;

  // Filled polygon
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.fillStyle   = 'rgba(100,200,255,0.12)';
  ctx.fill();
  ctx.strokeStyle = '#64c8ff';
  ctx.lineWidth   = 2.5;
  ctx.setLineDash([]);
  ctx.stroke();

  // Obstacle overlays
  const obsColors = {
    chimney:  ['rgba(255,60,60,0.35)',  '#ff4444'],
    skylight: ['rgba(255,230,50,0.35)', '#ffe030'],
    vent:     ['rgba(255,140,0,0.35)',  '#ff8c00'],
  };
  (appData?.obstaclePositions || []).forEach(o => {
    const [fill, stroke] = obsColors[o.type] || ['rgba(180,180,180,0.3)', '#aaa'];
    ctx.fillStyle   = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth   = 1.5;
    ctx.fillRect(o.px - o.pw / 2, o.py - o.ph / 2, o.pw, o.ph);
    ctx.strokeRect(o.px - o.pw / 2, o.py - o.ph / 2, o.pw, o.ph);
    ctx.fillStyle = stroke;
    ctx.font      = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(o.type, o.px, o.py - o.ph / 2 - 3);
    ctx.textAlign = 'left';
  });

  // Mid-edge add-point dots
  if (draggingIdx === null && hoveredPt === null) {
    ctx.setLineDash([]);
    pts.forEach((p, i) => {
      const next = pts[(i + 1) % pts.length];
      const mx = (p.x + next.x) / 2, my = (p.y + next.y) / 2;
      ctx.beginPath();
      ctx.arc(mx, my, 4, 0, Math.PI * 2);
      ctx.fillStyle   = 'rgba(100,200,255,0.5)';
      ctx.strokeStyle = '#64c8ff';
      ctx.lineWidth   = 1;
      ctx.fill();
      ctx.stroke();
    });
  }

  // Corner handles
  pts.forEach((p, i) => {
    const isHover = i === hoveredPt;
    const isDrag  = i === draggingIdx;
    ctx.beginPath();
    ctx.arc(p.x, p.y, isDrag ? 10 : isHover ? 9 : 7, 0, Math.PI * 2);
    ctx.fillStyle   = isDrag ? '#fff' : isHover ? '#a0e8ff' : '#64c8ff';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 2;
    ctx.stroke();
    ctx.fillStyle   = '#001833';
    ctx.font        = 'bold 10px sans-serif';
    ctx.textAlign   = 'center';
    ctx.fillText(i + 1, p.x, p.y + 4);
    ctx.textAlign   = 'left';
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
const EnhancedBlueprintTracer = ({ blueprintImage, onComplete }) => {
  const canvasRef   = useRef(null);
  const imageRef    = useRef(null);
  const runAnalysisRef = useRef(null); // stable ref so image onload never goes stale

  const [appData,     setAppData]     = useState(null);
  const [status,      setStatus]      = useState('idle');   // idle|analysing|done|error
  const [progress,    setProgress]    = useState(0);
  const [statusMsg,   setStatusMsg]   = useState('');
  const [errorMsg,    setErrorMsg]    = useState('');

  // Drag interaction
  const [hoveredPt,   setHoveredPt]   = useState(null);
  const [draggingIdx, setDraggingIdx] = useState(null);

  // Manual mode — ON by default, user switches to AI if they want
  const [manualMode,    setManualMode]    = useState(true);
  const [manualPts,     setManualPts]     = useState([]);
  const [drawingTool,   setDrawingTool]   = useState('outline'); // 'outline'|'obstacle'|'ridge'
  const [obstacles,     setObstacles]     = useState([]);
  const [currentObs,    setCurrentObs]    = useState(null);
  const [ridgeLines,    setRidgeLines]    = useState([]);        // [{x1,y1,x2,y2,type}]
  const [ridgeStart,    setRidgeStart]    = useState(null);      // first click of ridge line

  // ── Load image — just draw it, wait for user to choose AI or manual ───────
  const hasAnalysedRef = useRef(false);

  useEffect(() => {
    if (!blueprintImage) return;
    hasAnalysedRef.current = false;
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      if (canvasRef.current) {
        canvasRef.current.width  = Math.min(img.width, 1200);
        canvasRef.current.height = Math.round(img.height * (Math.min(img.width, 1200) / img.width));
        const ctx = canvasRef.current.getContext('2d');
        ctx.drawImage(img, 0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      // Do NOT auto-run AI — user starts in manual mode
    };
    img.src = blueprintImage;
  }, [blueprintImage]);

  // ── Redraw when data or interaction changes ─────────────────────────────
  useEffect(() => {
    if (!manualMode) {
      drawOverlay(canvasRef.current, imageRef.current, appData, hoveredPt, draggingIdx);
    }
  }, [appData, hoveredPt, draggingIdx, manualMode]);

  // ── Manual mode draw ────────────────────────────────────────────────────
  useEffect(() => {
    if (!manualMode || !canvasRef.current || !imageRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imageRef.current, 0, 0, canvas.width, canvas.height);

    // Draw outline polygon
    if (manualPts.length > 0) {
      ctx.beginPath();
      ctx.moveTo(manualPts[0].x, manualPts[0].y);
      manualPts.forEach(p => ctx.lineTo(p.x, p.y));
      if (manualPts.length > 2) ctx.closePath();
      ctx.strokeStyle = '#64c8ff'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.fillStyle = 'rgba(100,200,255,0.1)'; ctx.fill();
      manualPts.forEach((p, i) => {
        ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI*2);
        ctx.fillStyle = '#64c8ff'; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#001833'; ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center'; ctx.fillText(i+1, p.x, p.y+4); ctx.textAlign = 'left';
      });
    }

    // Draw placed obstacles with skylight peak indicator
    const obsColors = { chimney:'#ff4444', skylight:'#ffe030', vent:'#ff8c00', obstacle:'#ff9900' };
    obstacles.forEach(obs => {
      const c = obsColors[obs.type] || '#aaa';
      ctx.fillStyle = c + '44'; ctx.strokeStyle = c; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(obs.pts[0].x, obs.pts[0].y);
      obs.pts.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.closePath(); ctx.fill(); ctx.stroke();

      // For skylights: draw a peak/apex indicator (roof ridge lines from centre)
      if (obs.type === 'skylight') {
        const cx = obs.pts.reduce((s,p)=>s+p.x,0)/obs.pts.length;
        const cy = obs.pts.reduce((s,p)=>s+p.y,0)/obs.pts.length;
        // Draw X lines showing the ridge peaks
        ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.setLineDash([3,3]);
        // horizontal ridge
        ctx.beginPath(); ctx.moveTo(obs.pts[0].x, cy); ctx.lineTo(obs.pts[1].x, cy); ctx.stroke();
        // vertical ridge
        ctx.beginPath(); ctx.moveTo(cx, obs.pts[0].y); ctx.lineTo(cx, obs.pts[2].y); ctx.stroke();
        ctx.setLineDash([]);
        // Peak dot
        ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI*2);
        ctx.fillStyle = c; ctx.fill();
      }

      ctx.fillStyle = c; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
      const cx2 = obs.pts.reduce((s,p)=>s+p.x,0)/obs.pts.length;
      const cy2 = obs.pts.reduce((s,p)=>s+p.y,0)/obs.pts.length;
      ctx.fillText(obs.type, cx2, cy2 + (obs.type === 'skylight' ? -12 : 4));
      ctx.textAlign = 'left';
    });

    // Draw ridge/valley lines
    ridgeLines.forEach(l => {
      const isRidge = l.type === 'ridge';
      const col = isRidge ? '#ff6600' : '#00bbff';
      // Line
      ctx.beginPath();
      ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2);
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.setLineDash(isRidge ? [6, 3] : [3, 3]);
      ctx.stroke(); ctx.setLineDash([]);
      // Small arrow at end only
      const angle = Math.atan2(l.y2 - l.y1, l.x2 - l.x1);
      ctx.beginPath();
      ctx.moveTo(l.x2, l.y2);
      ctx.lineTo(l.x2 - 8 * Math.cos(angle - 0.45), l.y2 - 8 * Math.sin(angle - 0.45));
      ctx.lineTo(l.x2 - 8 * Math.cos(angle + 0.45), l.y2 - 8 * Math.sin(angle + 0.45));
      ctx.closePath(); ctx.fillStyle = col; ctx.fill();
      // Single label at midpoint only
      const mx = (l.x1 + l.x2) / 2, my = (l.y1 + l.y2) / 2;
      ctx.fillStyle = col; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(isRidge ? '▲ridge' : '▽valley', mx, my - 5);
      ctx.textAlign = 'left';
    });

    // Draw ridge start point (first click waiting for second)
    if (ridgeStart) {
      ctx.beginPath(); ctx.arc(ridgeStart.x, ridgeStart.y, 6, 0, Math.PI*2);
      ctx.fillStyle = drawingTool === 'ridge' ? '#ff6600' : '#00bbff';
      ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    }

    // Draw current obstacle in progress
    if (currentObs?.start) {
      const c = obsColors[currentObs.type] || '#aaa';
      ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.setLineDash([4,4]);
      ctx.strokeRect(currentObs.start.x-5, currentObs.start.y-5, 10, 10);
      ctx.setLineDash([]);
      ctx.fillStyle = c; ctx.font = '11px sans-serif';
      ctx.fillText('Click to place corner 2', currentObs.start.x+10, currentObs.start.y-8);
    }
  }, [manualMode, manualPts, obstacles, currentObs, ridgeLines, ridgeStart, drawingTool]);

  // ── Run Claude Vision ───────────────────────────────────────────────────
  const runAnalysis = useCallback(async (img) => {
    setStatus('analysing');
    setProgress(0);
    setStatusMsg('Sending image to AI...');
    setErrorMsg('');

    const canvas = canvasRef.current;
    const cW = canvas?.width  || 1200;
    const cH = canvas?.height || 900;

    const tmp = document.createElement('canvas');
    tmp.width = cW; tmp.height = cH;
    tmp.getContext('2d').drawImage(img, 0, 0, cW, cH);

    const mimeMatch = blueprintImage.match(/^data:([^;]+);base64,/);
    const mime      = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const b64       = tmp.toDataURL(mime).split(',')[1];

    const raw = await analyseBlueprint(b64, mime, (p) => {
      setProgress(p);
      setStatusMsg(
        p < 30  ? 'Connecting to AI vision...' :
        p < 70  ? 'AI is recognising roof shape and structure...' :
                  'Extracting polygon and building data...'
      );
    });

    setProgress(100);

    if (!raw || raw.confidence === 0) {
      setStatus('error');
      setErrorMsg(raw?.notes || 'Could not identify a building. Use Manual mode to trace the outline yourself.');
      return;
    }

    const data = toAppData(raw, cW, cH);

    if (!data.canvasPoints || data.canvasPoints.length < 3) {
      setStatus('error');
      setErrorMsg('AI could not trace the roof polygon. Use Manual mode to click the corners yourself.');
      return;
    }

    setAppData(data);
    setStatus('done');
    setStatusMsg(
      `✓ Detected ${data.roofShape} ${data.roofType} roof — ` +
      `${data.dimensions.width}' × ${data.dimensions.length}' ` +
      `(confidence ${Math.round(raw.confidence * 100)}%)`
    );
  }, [blueprintImage]);

  // Keep ref current so image-load handler always has the latest version
  useEffect(() => { runAnalysisRef.current = runAnalysis; }, [runAnalysis]);

  // ── Canvas coordinate helpers ───────────────────────────────────────────
  const getXY = (e) => {
    const r  = canvasRef.current.getBoundingClientRect();
    const sx = canvasRef.current.width  / r.width;
    const sy = canvasRef.current.height / r.height;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  };

  const hitCorner = (pts, x, y, r = 12) => {
    for (let i = pts.length - 1; i >= 0; i--)
      if (Math.hypot(pts[i].x - x, pts[i].y - y) < r) return i;
    return null;
  };

  const hitMidEdge = (pts, x, y, r = 8) => {
    for (let i = 0; i < pts.length; i++) {
      const next = pts[(i + 1) % pts.length];
      if (Math.hypot((pts[i].x + next.x) / 2 - x, (pts[i].y + next.y) / 2 - y) < r)
        return i + 1;
    }
    return null;
  };

  // ── Mouse handlers ──────────────────────────────────────────────────────
  const onMouseMove = useCallback((e) => {
    if (!appData || manualMode) return;
    const { x, y } = getXY(e);
    const pts = appData.canvasPoints;
    if (draggingIdx !== null) {
      setAppData(prev => ({
        ...prev,
        canvasPoints: prev.canvasPoints.map((p, i) => i === draggingIdx ? { x, y } : p),
      }));
    } else {
      setHoveredPt(hitCorner(pts, x, y));
    }
  }, [appData, draggingIdx, manualMode]);

  const onMouseDown = useCallback((e) => {
    if (manualMode) {
      const { x, y } = getXY(e);
      if (drawingTool === 'outline') {
        setManualPts(prev => [...prev, { x, y }]);
      } else if (drawingTool === 'ridge' || drawingTool === 'valley') {
        if (!ridgeStart) {
          setRidgeStart({ x, y });
        } else {
          setRidgeLines(prev => [...prev, { x1: ridgeStart.x, y1: ridgeStart.y, x2: x, y2: y, type: drawingTool }]);
          setRidgeStart(null);
        }
      } else {
        if (!currentObs) {
          setCurrentObs({ type: drawingTool, start: { x, y } });
        } else {
          const s = currentObs.start;
          setObstacles(prev => [...prev, {
            type: currentObs.type,
            pts: [{ x: s.x, y: s.y }, { x, y: s.y }, { x, y }, { x: s.x, y }]
          }]);
          setCurrentObs(null);
        }
      }
      return;
    }
    if (!appData) return;
    const { x, y } = getXY(e);
    const pts = appData.canvasPoints;
    const ci  = hitCorner(pts, x, y);
    if (ci !== null) { setDraggingIdx(ci); return; }
    const mi = hitMidEdge(pts, x, y);
    if (mi !== null) {
      setAppData(prev => ({
        ...prev,
        canvasPoints: [...prev.canvasPoints.slice(0, mi), { x, y }, ...prev.canvasPoints.slice(mi)],
      }));
      setDraggingIdx(mi);
    }
  }, [appData, manualMode, drawingTool, currentObs, ridgeStart]);

  const onMouseUp   = useCallback(() => setDraggingIdx(null), []);

  const onCtxMenu = useCallback((e) => {
    e.preventDefault();
    if (!appData || manualMode) return;
    const { x, y } = getXY(e);
    const idx = hitCorner(appData.canvasPoints, x, y);
    if (idx !== null && appData.canvasPoints.length > 3) {
      setAppData(prev => ({ ...prev, canvasPoints: prev.canvasPoints.filter((_, i) => i !== idx) }));
    }
  }, [appData, manualMode]);

  // ── Confirm ─────────────────────────────────────────────────────────────
  const handleConfirm = () => {
    const pts = manualMode ? manualPts : appData?.canvasPoints;
    if (!pts || pts.length < 3) return;
    const canvas = canvasRef.current;
    const cW = canvas?.width  || 1200;
    const cH = canvas?.height || 900;

    // Derive real-world dimensions from the polygon bounding box.
    // If AI gave us dimensions, use those. Otherwise estimate from
    // the drawn polygon's aspect ratio assuming ~60ft on the long side.
    const getPolygonDims = (canvasPts, aiW, aiL) => {
      if (aiW && aiL) return { w: aiW, l: aiL };
      const pxXs = canvasPts.map(p => p.x), pxZs = canvasPts.map(p => p.y);
      const pxW  = Math.max(...pxXs) - Math.min(...pxXs);
      const pxL  = Math.max(...pxZs) - Math.min(...pxZs);
      const base = 60; // assume longest side is ~60ft
      if (pxW >= pxL) return { w: base, l: Math.round(base * pxL / pxW) };
      return { w: Math.round(base * pxW / pxL), l: base };
    };

    let result;
    if (manualMode) {
      const { w, l } = getPolygonDims(pts, null, null);
      const isComplex = pts.length > 6;

      // Convert ridge/valley lines from canvas pixels → real-world feet
      // const toReal = p => ({ x: (p.x / cW) * w, y: (p.y / cH) * l });
      const realRidgeLines = ridgeLines.map(rl => ({
        type: rl.type,
        x1: (rl.x1 / cW) * w, y1: (rl.y1 / cH) * l,
        x2: (rl.x2 / cW) * w, y2: (rl.y2 / cH) * l,
      }));

      result = {
        polygon:           pts.map(p => ({ x: (p.x / cW) * w, y: (p.y / cH) * l })),
        dimensions:        { width: w, length: l, unit: 'feet' },
        roofPitch:         0.4167,
        roofPitchNotation: '5:12',
        roofType:          isComplex ? 'hip' : 'gable',
        roofShape:         isComplex ? 'irregular' : 'rectangle',
        buildingType:      'residential',
        wallHeight:        10,
        storeys:           1,
        ridgeLines:        realRidgeLines,
        features: {
          chimneys:  obstacles.filter(o => o.type === 'chimney').map(() => ({ type: 'standard' })),
          skylights: obstacles.filter(o => o.type === 'skylight').map(() => ({ width: 3, length: 4 })),
          vents:     obstacles.filter(o => o.type === 'vent').map(() => ({})),
          dormers:   [],
        },
        canvasPoints: pts,
      };
    } else {
      const { w, l } = getPolygonDims(pts,
        appData.dimensions?.width, appData.dimensions?.length);
      result = {
        ...appData,
        dimensions: { width: w, length: l, unit: 'feet' },
        polygon: pts.map(p => ({ x: (p.x / cW) * w, y: (p.y / cH) * l })),
      };
    }
    console.log(`Blueprint confirm: ${pts.length} pts, ${result.roofType}, ${result.dimensions.width}'×${result.dimensions.length}'`);
    onComplete(result);
  };

  // ── Button styles ────────────────────────────────────────────────────────
  const btn = (variant = 'primary', disabled = false) => ({
    padding: '9px 0', width: '100%', marginBottom: 8, borderRadius: 6, border: 'none',
    background: disabled ? 'rgba(60,60,60,0.3)'
      : variant === 'confirm'   ? 'linear-gradient(135deg,rgba(0,200,80,0.3),rgba(0,140,50,0.4))'
      : variant === 'danger'    ? 'rgba(200,50,50,0.2)'
      : variant === 'secondary' ? 'rgba(255,255,255,0.08)'
      : 'linear-gradient(135deg,rgba(100,200,255,0.22),rgba(70,130,255,0.3))',
    outline: `1px solid ${disabled ? 'transparent'
      : variant === 'confirm'   ? 'rgba(0,200,80,0.4)'
      : variant === 'danger'    ? 'rgba(200,50,50,0.4)'
      : 'rgba(100,200,255,0.35)'}`,
    color: '#fff', cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1, fontSize: 13, fontWeight: 600,
    transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
  });

  const canConfirm = manualMode ? manualPts.length >= 3 : appData?.canvasPoints?.length >= 3;

  return (
    <div style={{ color: '#fff', fontFamily: 'inherit' }}>

      {/* Error */}
      {status === 'error' && (
        <div style={{ padding: '10px 14px', marginBottom: 10, borderRadius: 7, fontSize: 13, background: 'rgba(255,60,60,0.1)', border: '1px solid rgba(255,80,80,0.3)', color: '#ff8080' }}>
          <strong>⚠ Analysis Failed</strong> — {errorMsg}
        </div>
      )}

      {/* Success banner — compact single line */}
      {status === 'done' && appData && !manualMode && (
        <div style={{ padding: '6px 12px', marginBottom: 10, borderRadius: 6, fontSize: 11, background: 'rgba(0,200,80,0.1)', border: '1px solid rgba(0,200,80,0.3)', color: '#64e896', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>✓</span><span>{statusMsg}</span>
        </div>
      )}

      {/* Data tiles — only when done */}
      {status === 'done' && appData && !manualMode && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 5, marginBottom: 10 }}>
          {[
            ['Size',   `${appData.dimensions.width}'×${appData.dimensions.length}'`],
            ['Roof',   appData.roofType.replace(/\b\w/g, c => c.toUpperCase())],
            ['Shape',  appData.roofShape.replace(/\b\w/g, c => c.toUpperCase())],
            ['Pitch',  appData.roofPitchNotation],
          ].map(([k, v]) => (
            <div key={k} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 5, padding: '5px 8px', fontSize: 11 }}>
              <div style={{ opacity: 0.5, marginBottom: 1 }}>{k}</div>
              <div style={{ fontWeight: 700, fontSize: 12 }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Manual mode toolbar — shown above canvas */}
      {manualMode && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          {[
            { id: 'outline',  label: '✏ Roof Outline', color: '#64c8ff' },
            { id: 'ridge',    label: '📐 Ridge Line',  color: '#ff6600' },
            { id: 'valley',   label: '〰 Valley Line', color: '#00bbff' },
            { id: 'chimney',  label: '🧱 Chimney',     color: '#ff4444' },
            { id: 'skylight', label: '🪟 Skylight',    color: '#ffe030' },
            { id: 'vent',     label: '⭕ Vent',         color: '#ff8c00' },
          ].map(t => (
            <button key={t.id} onClick={() => { setDrawingTool(t.id); setCurrentObs(null); }}
              style={{
                padding: '5px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: drawingTool === t.id ? t.color + '33' : 'rgba(255,255,255,0.06)',
                border: `1px solid ${drawingTool === t.id ? t.color : 'rgba(255,255,255,0.15)'}`,
                color: drawingTool === t.id ? t.color : 'rgba(255,255,255,0.7)',
              }}>
              {t.label}
            </button>
          ))}
          {(obstacles.length > 0 || ridgeLines.length > 0) && (
            <button onClick={() => { setObstacles([]); setRidgeLines([]); setRidgeStart(null); }}
              style={{ padding: '5px 10px', borderRadius: 5, fontSize: 11, cursor: 'pointer',
                background: 'rgba(200,50,50,0.15)', border: '1px solid rgba(200,50,50,0.3)', color: '#ff8080' }}>
              🗑 Clear All Markings
            </button>
          )}
        </div>
      )}

      {/* Canvas — always visible, AI runs in background */}
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <canvas
          ref={canvasRef}
          onMouseMove={onMouseMove}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onContextMenu={onCtxMenu}
          style={{
            border: `2px solid ${status === 'analysing' ? 'rgba(100,200,255,0.6)' : 'rgba(100,200,255,0.3)'}`,
            borderRadius: 8,
            cursor: manualMode ? 'crosshair' : draggingIdx !== null ? 'grabbing' : hoveredPt !== null ? 'grab' : 'default',
            width: '100%', height: 'auto', minHeight: 300,
            background: '#111', display: 'block',
            // Subtle pulse border while analysing
            animation: status === 'analysing' ? 'borderPulse 1.5s ease-in-out infinite' : 'none',
          }}
        />

        {/* Thin progress bar at bottom of canvas — never blocks drawing */}
        {status === 'analysing' && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            height: 3, borderRadius: '0 0 8px 8px', overflow: 'hidden',
          }}>
            <div style={{
              width: `${progress}%`, height: '100%',
              background: 'linear-gradient(90deg,#64c8ff,#4dabff)',
              transition: 'width 0.4s ease',
            }}/>
          </div>
        )}

        {/* AI status chip — top-left, small, non-blocking */}
        {status === 'analysing' && (
          <div style={{
            position: 'absolute', top: 8, left: 8,
            background: 'rgba(0,20,50,0.85)', borderRadius: 20,
            padding: '4px 10px', fontSize: 11, color: '#64c8ff',
            display: 'flex', alignItems: 'center', gap: 6,
            backdropFilter: 'blur(4px)',
            border: '1px solid rgba(100,200,255,0.3)',
            pointerEvents: 'none', // never blocks clicks
          }}>
            <span style={{
              width: 10, height: 10, display: 'inline-block',
              border: '2px solid rgba(100,200,255,0.3)', borderTopColor: '#64c8ff',
              borderRadius: '50%', animation: 'spin 0.8s linear infinite',
            }}/>
            {statusMsg || 'AI analysing…'}
          </div>
        )}

        {/* Point count badge */}
        {((appData?.canvasPoints?.length > 0) || manualPts.length > 0) && (
          <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.8)', borderRadius: 20, padding: '3px 10px', fontSize: 11, color: '#64c8ff', fontWeight: 700, pointerEvents: 'none' }}>
            {manualMode ? manualPts.length : appData.canvasPoints.length} pts
          </div>
        )}

        {/* Hint bar — bottom, only when done or manual */}
        {(status === 'done' || manualMode) && (
          <div style={{ position: 'absolute', bottom: 6, left: 8, background: 'rgba(0,0,0,0.7)', borderRadius: 5, padding: '4px 9px', fontSize: 10, color: 'rgba(255,255,255,0.65)', lineHeight: 1.5, maxWidth: '85%', pointerEvents: 'none' }}>
            {manualMode
              ? drawingTool === 'outline'
                ? '✏ Click roof corners clockwise • Undo removes last'
                : (drawingTool === 'ridge' || drawingTool === 'valley')
                  ? ridgeStart ? `Click 2nd point to complete ${drawingTool}` : `Click 1st point of ${drawingTool} line`
                  : `Click twice to place ${drawingTool} rectangle`
              : '↕ Drag handles • Right-click deletes • Click edge dot adds point'}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <button onClick={() => {
            const goingToAI = manualMode; // true = currently manual, switching to AI
            setManualMode(m => !m);
            setManualPts([]);
            // Trigger AI analysis when user explicitly switches to AI mode
            if (goingToAI && imageRef.current && status === 'idle' && !appData) {
              runAnalysisRef.current(imageRef.current);
            }
          }} style={{ ...btn('secondary'), width: 'auto' }}>
          {manualMode ? '🤖 Use AI Mode' : '✏ Manual Mode'}
        </button>
        <button
          onClick={manualMode
            ? () => {
                if (ridgeStart) { setRidgeStart(null); return; }
                if (drawingTool === 'ridge' || drawingTool === 'valley') {
                  setRidgeLines(p => p.slice(0, -1)); return;
                }
                if (currentObs) { setCurrentObs(null); return; }
                setManualPts(p => p.slice(0, -1));
              }
            : () => { setAppData(null); setStatus('idle'); if (imageRef.current) runAnalysisRef.current(imageRef.current); }}
          disabled={manualMode
            ? (manualPts.length === 0 && ridgeLines.length === 0 && !ridgeStart && !currentObs)
            : status === 'analysing'}
          style={{ ...btn('secondary', manualMode
            ? (manualPts.length === 0 && ridgeLines.length === 0 && !ridgeStart && !currentObs)
            : status === 'analysing'), width: 'auto' }}
        >
          {manualMode ? '↶ Undo' : '↺ Re-analyse'}
        </button>
      </div>

      {manualMode && (
        <button onClick={() => setManualPts([])} disabled={manualPts.length === 0} style={btn('danger', manualPts.length === 0)}>
          🗑 Clear Points
        </button>
      )}

      <button onClick={handleConfirm} disabled={!canConfirm} style={btn('confirm', !canConfirm)}>
        ✓ Generate 3D Model
      </button>

      {/* Tips */}
      <div style={{ marginTop: 10, padding: '10px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 6, fontSize: 11, color: 'rgba(255,255,255,0.5)', lineHeight: 1.7 }}>
        <strong style={{ color: 'rgba(255,255,255,0.75)' }}>How it works</strong>
        <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
          <li>AI visually recognises roof shape — no text/OCR scanning</li>
          <li>Detects complex shapes: L-shaped, T-shaped, irregular roofs</li>
          <li>Blue handles = corners — drag to refine position</li>
          <li>Click a midpoint dot on an edge to insert a new corner</li>
          <li>Right-click a corner handle to delete it</li>
          <li>Use Manual mode if AI cannot detect the shape</li>
        </ul>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes borderPulse {
          0%, 100% { border-color: rgba(100,200,255,0.4); }
          50%       { border-color: rgba(100,200,255,0.9); }
        }
      `}</style>
    </div>
  );
};

export default EnhancedBlueprintTracer;