const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Server } = require('socket.io');
const FtpSrv = require('ftp-srv');
const ftpClient = require('basic-ftp');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Set up multer to store uploaded files into the 'shared' folder.
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'shared');
  },
  filename: (req, file, cb) => {
    // In production you may want to sanitize filenames.
    cb(null, file.originalname);
  }
});
const upload = multer({ storage });

// Serve static files from the "public" directory.
app.use(express.static(path.join(__dirname, 'public')));

// --- Endpoints ---

// Main page.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// File upload endpoint (Send File).
app.post('/upload', upload.single('file'), (req, res) => {
  const fileName = req.file.originalname;
  io.emit('log', `File uploaded: ${fileName}`);
  
  // (Optional: Add file-splitting logic here if file size exceeds a threshold.)
  
  res.json({ success: true, message: 'File uploaded and shared successfully.' });
});

// List available shared files.
app.get('/files', (req, res) => {
  const sharedDir = path.join(__dirname, 'shared');
  fs.readdir(sharedDir, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Error reading files.' });
    }
    res.json({ files });
  });
});

// Download file endpoint (Receive File).
// This endpoint uses basic-ftp as a proxy client to connect to the local FTPS server.
app.get('/download', async (req, res) => {
  const fileName = req.query.file;
  if (!fileName) {
    return res.status(400).send('Missing "file" parameter.');
  }
  const localPath = path.join(__dirname, 'shared', fileName);
  if (!fs.existsSync(localPath)) {
    return res.status(404).send('File not found.');
  }
  
  // Connect to the local FTPS server.
  const client = new ftpClient.Client();
  client.ftp.verbose = false;
  try {
    await client.access({
      host: '127.0.0.1',
      port: 2121,
      user: 'anonymous',
      password: 'anonymous',
      secure: true,
      secureOptions: { rejectUnauthorized: false } // For self-signed certificates
    });
    
    // Download the file via FTP to a temporary location.
    const tempDir = path.join(__dirname, 'temp');
    fs.mkdirSync(tempDir, { recursive: true });
    const tempFilePath = path.join(tempDir, fileName);
    await client.downloadTo(tempFilePath, fileName);
    
    io.emit('log', `File downloaded via FTP: ${fileName}`);
    client.close();
    
    // Send the file to the receiver.
    res.download(tempFilePath, fileName, (err) => {
      if (err) {
        io.emit('log', `Error sending file ${fileName}: ${err.message}`);
      }
      // Optionally, delete the temporary file after sending.
      fs.unlink(tempFilePath, () => {});
    });
  } catch (err) {
    io.emit('log', `FTP download error: ${err.message}`);
    res.status(500).send('Error downloading file via FTP.');
  }
});

// Start the HTTP server.
const HTTP_PORT = process.env.PORT || 3000;
server.listen(HTTP_PORT, () => {
  console.log(`HTTP server listening on port ${HTTP_PORT}`);
});

// --- Start FTPS Server using ftp-srv ---

const ftpPort = 2121;
const ftpServer = new FtpSrv({
  url: `ftps://0.0.0.0:${ftpPort}`,
  tls: {
    key: fs.readFileSync(path.join(__dirname, 'ftp', 'key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'ftp', 'cert.pem'))
  },
  // Allow anonymous logins for simplicity.
  anonymous: true
});

// When a client logs in, serve the "shared" directory.
ftpServer.on('login', ({ connection, username, password }, resolve) => {
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

// --- Socket.IO for real-time logging ---
io.on('connection', (socket) => {
  console.log('A client connected for real-time logging.');
});
