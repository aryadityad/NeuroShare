const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const path = require('path');
const fs = require('fs');
const fsPromises = fs.promises;
const multer = require('multer');
const { Server } = require('socket.io');
const FtpSrv = require('ftp-srv');
const ftpClient = require('basic-ftp');
const crypto = require('crypto');

const app = express();

// Enhance security with Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'", "'unsafe-inline'"], // For Socket.IO client
      "connect-src": ["'self'", "ws:", "wss:"]
    }
  }
}));

// Apply rate limiting (100 requests per 15 minutes per IP)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

// For parsing JSON and URL encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const server = http.createServer(app);
const io = new Server(server);

// Ensure required directories exist
['shared', 'temp', 'chunks'].forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

// In-memory store for upload/download sessions
const uploadSessions = new Map();
const downloadSessions = new Map();

// Configure multer to store chunk uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = req.body.sessionId;
    const sessionDir = path.join(__dirname, 'chunks', sessionId);
    
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    
    cb(null, sessionDir);
  },
  filename: (req, file, cb) => {
    const chunkIndex = req.body.chunkIndex;
    cb(null, `chunk-${chunkIndex}`);
  }
});

const upload = multer({ storage });

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize a new upload session
app.post('/upload/init', (req, res) => {
  try {
    const { filename, fileSize, totalChunks } = req.body;
    const sessionId = crypto.randomUUID();
    
    uploadSessions.set(sessionId, {
      filename,
      fileSize,
      totalChunks,
      chunks: new Array(parseInt(totalChunks)).fill(false),
      createdAt: Date.now()
    });
    
    io.emit('log', `Upload session initiated for ${filename} (${totalChunks} chunks)`);
    res.json({ sessionId });
  } catch (error) {
    console.error('Error initializing upload:', error);
    res.status(500).json({ error: 'Failed to initialize upload' });
  }
});

// Upload a chunk
app.post('/upload/chunk', upload.single('chunk'), (req, res) => {
  try {
    const { sessionId, chunkIndex } = req.body;
    const session = uploadSessions.get(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Upload session not found' });
    }
    
    // Mark chunk as uploaded
    session.chunks[chunkIndex] = true;
    
    res.json({ 
      success: true, 
      chunkIndex,
      uploadedChunks: session.chunks.filter(Boolean).length,
      totalChunks: session.totalChunks
    });
  } catch (error) {
    console.error('Error uploading chunk:', error);
    res.status(500).json({ error: 'Failed to upload chunk' });
  }
});

// Complete upload and combine chunks
app.post('/upload/complete', async (req, res) => {
  const { sessionId, filename } = req.body;
  const session = uploadSessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Upload session not found' });
  }
  
  // Check if all chunks are uploaded
  const allUploaded = session.chunks.every(Boolean);
  if (!allUploaded) {
    return res.status(400).json({ error: 'Not all chunks have been uploaded' });
  }
  
  try {
    const outputPath = path.join(__dirname, 'shared', filename);
    const tempDir = path.join(__dirname, 'chunks', sessionId);
    const writeStream = fs.createWriteStream(outputPath);
    
    // Combine all chunks in order
    for (let i = 0; i < session.totalChunks; i++) {
      const chunkPath = path.join(tempDir, `chunk-${i}`);
      const chunkData = await fsPromises.readFile(chunkPath);
      writeStream.write(chunkData);
    }
    
    writeStream.end();
    
    // Wait for file to be written
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });
    
    // Clean up chunks
    await fsPromises.rm(tempDir, { recursive: true, force: true });
    
    // Remove session
    uploadSessions.delete(sessionId);
    
    io.emit('log', `File reassembled and saved: ${filename}`);
    res.json({ success: true, message: 'File uploaded successfully' });
  } catch (error) {
    console.error('Error completing upload:', error);
    res.status(500).json({ error: 'Failed to complete upload' });
  }
});

// List files endpoint with file size info
app.get('/files', (req, res) => {
  const sharedDir = path.join(__dirname, 'shared');
  fs.readdir(sharedDir, async (err, fileNames) => {
    if (err) return res.status(500).json({ error: 'Error reading files.' });
    
    try {
      const filePromises = fileNames.map(async (name) => {
        const stats = await fsPromises.stat(path.join(sharedDir, name));
        return {
          name,
          size: stats.size,
          created: stats.birthtime
        };
      });
      
      const files = await Promise.all(filePromises);
      res.json({ files });
    } catch (error) {
      console.error('Error getting file stats:', error);
      res.status(500).json({ error: 'Error getting file information' });
    }
  });
});

// Initialize download session
app.post('/download/init', async (req, res) => {
  try {
    const { filename } = req.body;
    const filePath = path.join(__dirname, 'shared', filename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const stats = await fsPromises.stat(filePath);
    const fileSize = stats.size;
    
    // Define chunk size - 1MB
    const chunkSize = 1024 * 1024;
    const totalChunks = Math.ceil(fileSize / chunkSize);
    
    // Create session
    const sessionId = crypto.randomUUID();
    downloadSessions.set(sessionId, {
      filename,
      filePath,
      fileSize,
      chunkSize,
      totalChunks,
      createdAt: Date.now()
    });
    
    io.emit('log', `Download session initiated for ${filename} (${totalChunks} chunks)`);
    res.json({ sessionId, totalChunks, fileSize });
  } catch (error) {
    console.error('Error initializing download:', error);
    res.status(500).json({ error: 'Failed to initialize download' });
  }
});

// Download a specific chunk
app.get('/download/chunk', async (req, res) => {
  try {
    const { sessionId, chunkIndex } = req.query;
    const session = downloadSessions.get(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Download session not found' });
    }
    
    const index = parseInt(chunkIndex);
    if (isNaN(index) || index < 0 || index >= session.totalChunks) {
      return res.status(400).json({ error: 'Invalid chunk index' });
    }
    
    // Calculate chunk range
    const start = index * session.chunkSize;
    const end = Math.min(start + session.chunkSize - 1, session.fileSize - 1);
    
    // Create read stream for the specific chunk
    const fileStream = fs.createReadStream(session.filePath, { start, end });
    
    // Set headers
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', end - start + 1);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Range', `bytes ${start}-${end}/${session.fileSize}`);
    
    // Stream the chunk
    fileStream.pipe(res);
  } catch (error) {
    console.error('Error downloading chunk:', error);
    res.status(500).json({ error: 'Failed to download chunk' });
  }
});

// Automatic session cleanup (every hour)
setInterval(() => {
  const currentTime = Date.now();
  const sessionTimeout = 3600000; // 1 hour in milliseconds
  
  // Clean up upload sessions
  for (const [sessionId, session] of uploadSessions.entries()) {
    if (currentTime - session.createdAt > sessionTimeout) {
      // Remove chunks directory
      const chunksDir = path.join(__dirname, 'chunks', sessionId);
      if (fs.existsSync(chunksDir)) {
        fs.rm(chunksDir, { recursive: true, force: true }, (err) => {
          if (err) console.error(`Error removing chunks dir for session ${sessionId}:`, err);
        });
      }
      uploadSessions.delete(sessionId);
      console.log(`Cleaned up stale upload session: ${sessionId}`);
    }
  }
  
  // Clean up download sessions
  for (const [sessionId, session] of downloadSessions.entries()) {
    if (currentTime - session.createdAt > sessionTimeout) {
      downloadSessions.delete(sessionId);
      console.log(`Cleaned up stale download session: ${sessionId}`);
    }
  }
}, 3600000);

// Legacy download endpoint (using FTP) for backward compatibility
app.get('/download', async (req, res) => {
  const fileName = req.query.file;
  if (!fileName) return res.status(400).send('Missing "file" parameter.');
  const localPath = path.join(__dirname, 'shared', fileName);
  if (!fs.existsSync(localPath)) return res.status(404).send('File not found.');

  const client = new ftpClient.Client();
  client.ftp.verbose = true;
  try {
    await client.access({
      host: '127.0.0.1',
      port: 2121,
      user: 'anonymous',
      password: 'anonymous',
      secure: true,
      secureOptions: { rejectUnauthorized: false }
    });
    const tempDir = path.join(__dirname, 'temp');
    const tempFilePath = path.join(tempDir, fileName);
    await client.downloadTo(tempFilePath, fileName);
    io.emit('log', `File downloaded via FTP: ${fileName}`);
    client.close();
    res.download(tempFilePath, fileName, (err) => {
      if (err) io.emit('log', `Error sending file ${fileName}: ${err.message}`);
      fs.unlink(tempFilePath, () => {});
    });
  } catch (err) {
    io.emit('log', `FTP download error: ${err.message}`);
    console.error('Detailed FTP error:', err);
    res.status(500).send('Error downloading file via FTP.');
  }
});

// Start HTTP server
const HTTP_PORT = process.env.PORT || 3000;
server.listen(HTTP_PORT, () => {
  console.log(`HTTP server listening on port ${HTTP_PORT}`);
});

// Start FTPS server with passive mode configuration
const ftpPort = 2121;
const ftpServer = new FtpSrv({
  url: `ftps://0.0.0.0:${ftpPort}`,
  pasv_url: "127.0.0.1", // Adjust if needed for external connections
  tls: {
    key: fs.readFileSync(path.join(__dirname, 'ftp', 'key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'ftp', 'cert.pem'))
  },
  anonymous: true
});

ftpServer.on('login', ({ username, password }, resolve) => {
  resolve({ root: path.join(__dirname, 'shared') });
});

ftpServer.listen()
  .then(() => {
    console.log(`FTPS server started on port ${ftpPort} with TLS.`);
    io.emit('log', `FTPS server started on port ${ftpPort} with TLS.`);
  })
  .catch(err => {
    console.error('Error starting FTPS server:', err);
  });

// Socket.IO for real-time logging
io.on('connection', (socket) => {
  console.log('A client connected for real-time logging.');
});
