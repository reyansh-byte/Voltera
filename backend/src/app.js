const express    = require('express');
const bodyParser = require('body-parser');
const cors       = require('cors');

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

// ── Debug: confirm env loaded ────────────────────────────────────────────────
console.log('API key loaded:', !!process.env.GEMINI_API_KEY);

const solarRoutes    = require('./routes/solarRoutes');
const anthropicProxy = require('./anthropicProxy');

const app  = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: ['http://localhost:3000', 'http://127.0.0.1:3000'] }));
app.use(bodyParser.json({ limit: '20mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '20mb' }));

app.use('/api/solar',     solarRoutes);
app.use('/api/anthropic', anthropicProxy);

// ── Catch-all: log any unmatched routes so you can see what's 404-ing ────────
app.use((req, res) => {
  console.log(`[404] ${req.method} ${req.path}`);
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));