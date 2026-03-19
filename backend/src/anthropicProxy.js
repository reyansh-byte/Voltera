/**
 * anthropicProxy.js  — Google Gemini free tier
 * .env:  GEMINI_API_KEY=AIza...
 */
const express = require('express');
const router  = express.Router();

let fetchFn;
try { fetchFn = global.fetch || require('node-fetch'); }
catch { fetchFn = global.fetch; }

router.post('/messages', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set in .env' });

  try {
    const userMsg   = (req.body.messages || []).find(m => m.role === 'user');
    const parts     = Array.isArray(userMsg?.content) ? userMsg.content : [];
    const textPart  = parts.find(p => p.type === 'text');
    const imagePart = parts.find(p => p.type === 'image');

    const geminiParts = [];
    if (imagePart?.source?.data) {
      geminiParts.push({
        inline_data: {
          mime_type: imagePart.source.media_type || 'image/jpeg',
          data: imagePart.source.data,
        }
      });
    }
    if (textPart?.text) geminiParts.push({ text: textPart.text });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const geminiRes = await fetchFn(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: geminiParts }],
        generationConfig: {
          temperature:     0.1,
          maxOutputTokens: 8192,      // ← raised: 2000 was causing truncation
          responseMimeType: 'application/json',  // ← forces Gemini to return pure JSON
        },
      }),
    });

    const geminiData = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error('[geminiProxy] error:', JSON.stringify(geminiData));
      return res.status(geminiRes.status).json(geminiData);
    }

    // Log finish reason so we can detect truncation
    const finishReason = geminiData.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      console.warn('[geminiProxy] Non-STOP finish reason:', finishReason);
    }

    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    res.json({ content: [{ type: 'text', text }], model: 'gemini-2.5-flash', role: 'assistant' });

  } catch (err) {
    console.error('[geminiProxy] fetch error:', err.message);
    res.status(502).json({ error: 'Gemini request failed', detail: err.message });
  }
});

module.exports = router;