const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const http = require('http');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// Set up multer to temporarily store uploaded chunks
const upload = multer({ dest: 'uploads/' });
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Object to temporarily store chunk info per file
const fileChunks = {};

// Endpoint to handle chunk uploads
app.post('/upload-chunk', upload.single('chunk'), (req, res) => {
    const { filename, chunkIndex, totalChunks } = req.body;
    if (!req.file || !filename || chunkIndex === undefined || totalChunks === undefined) {
        return res.status(400).send('Invalid request');
    }

    // Save chunk with a unique name based on chunkIndex
    const chunkPath = path.join(uploadDir, `${filename}.part${chunkIndex}`);
    fs.renameSync(req.file.path, chunkPath);

    // Store the chunk path
    if (!fileChunks[filename]) fileChunks[filename] = [];
    fileChunks[filename].push(chunkPath);

    // Calculate progress and send update to clients via Socket.IO
    const progress = (fileChunks[filename].length / totalChunks) * 100;
    io.emit('uploadProgress', { filename, progress });

    // If all chunks are received, reassemble the file
    if (fileChunks[filename].length === parseInt(totalChunks)) {
        const finalPath = path.join(uploadDir, filename);
        const writeStream = fs.createWriteStream(finalPath);

        // Ensure chunks are in the correct order
        fileChunks[filename].sort((a, b) => {
            const aIndex = parseInt(a.split('part')[1]);
            const bIndex = parseInt(b.split('part')[1]);
            return aIndex - bIndex;
        });

        // Write each chunk sequentially
        fileChunks[filename].forEach((chunk) => {
            const data = fs.readFileSync(chunk);
            writeStream.write(data);
            fs.unlinkSync(chunk); // Remove chunk after writing
        });

        writeStream.end();
        delete fileChunks[filename];
    }

    res.send({ message: 'Chunk received', progress });
});

// Endpoint to list available files (exclude chunk files)
app.get('/files', (req, res) => {
    fs.readdir(uploadDir, (err, files) => {
        if (err) return res.status(500).send('Error listing files');
        // Return only files that are not chunk parts
        res.json(files.filter(file => !file.includes('.part')));
    });
});

// Endpoint to download a file
app.get('/download/:filename', (req, res) => {
    const filePath = path.join(uploadDir, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
    res.download(filePath);
});

server.listen(5000, () => console.log('Backend running on port 5000'));
