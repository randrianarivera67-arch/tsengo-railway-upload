const express = require('express');
const multer = require('multer');
const FormData = require('form-data');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const BACKEND_URL = process.env.BACKEND_URL || 'https://tsengo-railway-upload.up.railway.app';

// Chunk storage en mémoire
const chunks = {};

// Upload chunk
app.post('/upload/chunk', upload.single('chunk'), (req, res) => {
  const { uploadId, chunkIndex, totalChunks, filename, mimetype } = req.body;
  if (!uploadId || !req.file) return res.status(400).json({ error: 'Missing data' });
  if (!chunks[uploadId]) chunks[uploadId] = { parts: {}, filename, mimetype, totalChunks: parseInt(totalChunks) };
  chunks[uploadId].parts[parseInt(chunkIndex)] = req.file.buffer;
  res.json({ ok: true, received: chunkIndex });
});

// Finalize → Telegram
app.post('/upload/finalize', async (req, res) => {
  const { uploadId } = req.body;
  if (!chunks[uploadId]) return res.status(404).json({ error: 'Upload not found' });
  const { parts, filename, mimetype, totalChunks } = chunks[uploadId];
  if (Object.keys(parts).length !== totalChunks) return res.status(400).json({ error: 'Missing chunks' });
  const buffers = [];
  for (let i = 0; i < totalChunks; i++) buffers.push(parts[i]);
  const fullBuffer = Buffer.concat(buffers);
  delete chunks[uploadId];
  const form = new FormData();
  form.append('chat_id', CHAT_ID);
  form.append('document', fullBuffer, { filename: filename || 'video.mp4', contentType: mimetype });
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, { method: 'POST', body: form, headers: form.getHeaders() });
  const data = await r.json();
  if (!data.ok) return res.status(500).json({ error: data.description });
  const fileId = data.result.document?.file_id || data.result.video?.file_id;
  const type = mimetype.startsWith('video') ? 'video' : mimetype.startsWith('audio') ? 'audio' : 'image';
  res.json({ url: `${BACKEND_URL}/media?file_id=${fileId}`, fileId, type });
});

// Proxy media
app.get('/media', async (req, res) => {
  const { file_id } = req.query;
  if (!file_id) return res.status(400).json({ error: 'Missing file_id' });
  const fRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${file_id}`);
  const fData = await fRes.json();
  if (!fData.ok) return res.status(404).json({ error: 'File not found' });
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fData.result.file_path}`;
  const r = await fetch(url);
  res.setHeader('Content-Type', r.headers.get('content-type') || 'video/mp4');
  res.setHeader('Cache-Control', 'public, max-age=31536000');
  r.body.pipe(res);
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(process.env.PORT || 3000, () => console.log('Railway upload server running'));
