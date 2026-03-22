const express    = require('express');
const bodyParser = require('body-parser');
const cors       = require('cors');

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

// ── Debug: confirm env loaded ────────────────────────────────────────────────
console.log('API key loaded:', !!process.env.GEMINI_API_KEY);
console.log('Maps key loaded:', !!process.env.REACT_APP_GOOGLE_MAPS_API_KEY);

const solarRoutes    = require('./routes/solarRoutes');
const anthropicProxy = require('./anthropicProxy');

const app  = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: ['http://localhost:3000', 'http://127.0.0.1:3000'] }));
app.use(bodyParser.json({ limit: '20mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '20mb' }));

app.use('/api/solar',     solarRoutes);
app.use('/api/anthropic', anthropicProxy);

// ── Google Maps Static API proxy ─────────────────────────────────────────────
// Forwards requests to Google's Static Maps API server-side so the
// Maps API key stays off the browser and CORS is avoided.
// Requires GOOGLE_MAPS_KEY in .env
app.get('/api/maps-static', async (req, res) => {
  const key = process.env.GOOGLE_MAPS_KEY;
  if (!key) {
    console.error('[maps-static] GOOGLE_MAPS_KEY not set in .env');
    return res.status(500).json({ error: 'GOOGLE_MAPS_KEY not set in .env' });
  }

  const { center, zoom, size, maptype, scale } = req.query;
  if (!center || !zoom) {
    return res.status(400).json({ error: 'center and zoom are required' });
  }

  const url = `https://maps.googleapis.com/maps/api/staticmap`
    + `?center=${center}&zoom=${zoom}&size=${size || '640x640'}`
    + `&maptype=${maptype || 'satellite'}&scale=${scale || '2'}&key=${key}`;

  try {
    let fetchFn;
    try { fetchFn = global.fetch || require('node-fetch'); }
    catch { fetchFn = global.fetch; }

    const imgRes = await fetchFn(url);
    if (!imgRes.ok) {
      const text = await imgRes.text();
      console.error('[maps-static] Google error:', imgRes.status, text);
      return res.status(imgRes.status).send(text);
    }
    res.set('Content-Type', imgRes.headers.get('content-type') || 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    // Stream the image back
    const buffer = await imgRes.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[maps-static] fetch error:', err.message);
    res.status(502).json({ error: 'Maps Static fetch failed', detail: err.message });
  }
});

// ── Catch-all: log any unmatched routes so you can see what's 404-ing ────────
app.use((req, res) => {
  console.log(`[404] ${req.method} ${req.path}`);
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));