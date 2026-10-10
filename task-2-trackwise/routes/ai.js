const express = require('express');
const { executeIntentIntent } = require('../services/ai/intentEngine');

const router = express.Router();

router.get('/status', (req, res) => {
  const configured = !!process.env.OLLAMA_BASE_URL;
  res.json({
    success: true,
    data: {
      AI_AVAILABLE: configured,
      provider: configured ? 'Ollama' : 'Fallback parser',
      model: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
      status: configured ? 'configured' : 'fallback-only',
    },
  });
});

router.post('/chat', async (req, res, next) => {
  try {
    const { message } = req.body;
    if (!message || !String(message).trim()) {
      return res.status(400).json({ success: false, message: 'Message is required.' });
    }

    const lower = String(message).trim();
    if (process.env.OLLAMA_BASE_URL) {
      try {
        const response = await fetch(`${process.env.OLLAMA_BASE_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: process.env.OLLAMA_MODEL || 'qwen2.5:7b',
            stream: false,
            messages: [{ role: 'user', content: lower }],
            options: { timeout: Number(process.env.OLLAMA_TIMEOUT_MS || 30000) },
          })
        });

        if (!response.ok) {
          throw new Error(`Ollama request failed with status ${response.status}`);
        }

        const result = await response.json();
        const content = result?.message?.content || 'No response received.';
        return res.json({ success: true, data: { assistant: content, provider: 'ollama', status: 'ai' } });
      } catch (error) {
        console.warn('Ollama request failed, falling back to deterministic parser:', error.message);
      }
    }

    const result = await executeIntentIntent(lower);
    res.json({ success: true, data: { assistant: result.message, provider: 'fallback', status: 'fallback' } });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
