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

// Ensure required directories exist
const directories = ['shared', 'temp'];
directories.forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

// Configure multer to store files in the 'shared' folder.
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'shared');
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage });

// Serve static files from 'public'
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  }
  const fileName = req.file.originalname;
  io.emit('log', `File uploaded: ${fileName}`);
  res.json({ success: true, message: 'File uploaded successfully.' });
});

// List files endpoint
app.get('/files', (req, res) => {
  const sharedDir = path.join(__dirname, 'shared');
  fs.readdir(sharedDir, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Error reading files.' });
    }
    res.json({ files });
  });
});

// Download endpoint using basic-ftp
app.get('/download', async (req, res) => {
  const fileName = req.query.file;
  if (!fileName) return res.status(400).send('Missing "file" parameter.');
  const localPath = path.join(__dirname, 'shared', fileName);
  if (!fs.existsSync(localPath)) return res.status(404).send('File not found.');

  const client = new ftpClient.Client();
  client.ftp.verbose = false;
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
    res.status(500).send('Error downloading file via FTP.');
  }
});

// Start HTTP server
const HTTP_PORT = process.env.PORT || 3000;
server.listen(HTTP_PORT, () => {
  console.log(`HTTP server listening on port ${HTTP_PORT}`);
});

// Start FTPS server with passive mode configured
const ftpPort = 2121;
const ftpServer = new FtpSrv({
  url: `ftps://0.0.0.0:${ftpPort}`,
  pasv_url: "127.0.0.1", // This allows passive connections by specifying the external IP/hostname.
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

// Socket.IO for logging
io.on('connection', (socket) => {
  console.log('A client connected for real-time logging.');
});
