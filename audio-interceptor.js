const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const AUDIO_COACH_URL = process.env.AUDIO_COACH_URL || 'https://collegeworks-audio-coach-production.up.railway.app/api/audio-coach';
const RAG_API_URL = process.env.RAG_API_URL || 'http://rag-api.railway.internal';
const PORT = process.env.PORT || 3000;

const AUDIO_MIME_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/mp4',
  'audio/webm',
  'audio/ogg',
];

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'Audio Interceptor' });
});

// Main file processing endpoint
app.post('/api/files', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const mimeType = req.file.mimetype;
    const filename = req.file.originalname;

    console.log(`[Audio Interceptor] Received file: ${filename} (${mimeType})`);

    // Check if audio file
    if (AUDIO_MIME_TYPES.includes(mimeType)) {
      console.log(`[Audio Interceptor] Audio file detected - routing to audio coach`);
      
      try {
        // Forward to audio coach
        const form = new FormData();
        form.append('file', req.file.buffer, filename);
        
        const coachResponse = await axios.post(AUDIO_COACH_URL, form, {
          headers: form.getHeaders(),
          timeout: 120000
        });

        console.log(`[Audio Interceptor] Audio coach response received`);

        // Return audio coach results formatted for LibreChat
        return res.json({
          type: 'audio_coaching',
          success: true,
          data: coachResponse.data,
          filename: filename
        });
      } catch (error) {
        console.error(`[Audio Interceptor] Audio coach error:`, error.message);
        return res.status(500).json({
          type: 'audio_coaching',
          success: false,
          error: `Audio coach processing failed: ${error.message}`
        });
      }
    }

    // Not audio - forward to RAG API for normal processing
    console.log(`[Audio Interceptor] Non-audio file - forwarding to RAG API`);
    
    const form = new FormData();
    form.append('file', req.file.buffer, filename);
    
    // Forward any other query params
    const queryParams = new URLSearchParams(req.query).toString();
    const ragUrl = queryParams ? `${RAG_API_URL}/api/files?${queryParams}` : `${RAG_API_URL}/api/files`;

    const ragResponse = await axios.post(ragUrl, form, {
      headers: form.getHeaders(),
      timeout: 120000
    });

    return res.json(ragResponse.data);

  } catch (error) {
    console.error(`[Audio Interceptor] Error:`, error.message);
    res.status(500).json({ 
      error: 'File processing failed', 
      details: error.message 
    });
  }
});

// Forward other RAG API endpoints
app.all('*', async (req, res) => {
  try {
    const ragUrl = `${RAG_API_URL}${req.path}`;
    
    const response = await axios({
      method: req.method,
      url: ragUrl,
      data: req.body,
      params: req.query,
      headers: {
        ...req.headers,
        'host': new URL(RAG_API_URL).host
      },
      timeout: 120000
    });

    res.status(response.status).json(response.data);
  } catch (error) {
    console.error(`[Audio Interceptor] Proxy error:`, error.message);
    res.status(500).json({ error: 'Proxy error', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🎙️  Audio Interceptor listening on port ${PORT}`);
  console.log(`📍 Audio Coach URL: ${AUDIO_COACH_URL}`);
  console.log(`📍 RAG API URL: ${RAG_API_URL}`);
});
