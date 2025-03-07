const socket = io();
const consoleDiv = document.getElementById('console');
const uploadForm = document.getElementById('uploadForm');
const fileInput = document.getElementById('fileInput');
const refreshBtn = document.getElementById('refreshBtn');
const fileList = document.getElementById('fileList');
const progressContainer = document.getElementById('uploadProgressContainer');
const progressBar = document.getElementById('uploadProgress');

// Configuration for chunked uploads
const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
const MAX_PARALLEL_UPLOADS = 3; // Maximum parallel chunk uploads

// Append log messages to the console area.
function log(message) {
  const p = document.createElement('p');
  p.textContent = message;
  consoleDiv.appendChild(p);
  consoleDiv.scrollTop = consoleDiv.scrollHeight;
}

// Listen for log messages from the server.
socket.on('log', (message) => {
  log(message);
});

// Handle file upload with chunking and parallel transfers
uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = fileInput.files[0];
  if (!file) {
    log("Please select a file to upload.");
    return;
  }
  
  progressContainer.classList.remove('hidden');
  log(`Starting upload of ${file.name} (${formatFileSize(file.size)})`);
  
  try {
    // First, initiate the upload session
    const sessionRes = await fetch('/upload/init', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filename: file.name,
        fileSize: file.size,
        totalChunks: Math.ceil(file.size / CHUNK_SIZE)
      })
    });
    
    if (!sessionRes.ok) {
      throw new Error('Failed to initialize upload session');
    }
    
    const { sessionId } = await sessionRes.json();
    log(`Upload session initiated: ${sessionId}`);
    
    // Split file into chunks
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const uploadQueue = Array.from({ length: totalChunks }, (_, i) => i);
    let completedChunks = 0;
    let activeUploads = 0;
    let failed = false;
    
    // Update progress function
    const updateProgress = () => {
      const percentComplete = Math.round((completedChunks / totalChunks) * 100);
      progressBar.style.width = percentComplete + '%';
      log(`Upload progress: ${percentComplete}%`);
    };
    
    // Process chunks with limited concurrency
    async function processUploadQueue() {
      if (failed) return;
      
      while (uploadQueue.length > 0 && activeUploads < MAX_PARALLEL_UPLOADS) {
        const chunkIndex = uploadQueue.shift();
        activeUploads++;
        
        // Upload chunk
        uploadChunk(file, chunkIndex, sessionId)
          .then(() => {
            completedChunks++;
            activeUploads--;
            updateProgress();
            processUploadQueue();
            
            // Check if all chunks are uploaded
            if (completedChunks === totalChunks) {
              completeUpload(sessionId, file.name);
            }
          })
          .catch(err => {
            log(`Error uploading chunk ${chunkIndex}: ${err.message}`);
            failed = true;
            activeUploads--;
            // Put the failed chunk back in queue for retry (could implement retry logic here)
            uploadQueue.unshift(chunkIndex);
          });
      }
    }
    
    // Start the upload process
    processUploadQueue();
    
  } catch (error) {
    log(`Upload error: ${error.message}`);
    progressBar.style.width = '0%';
  }
});

// Upload a single chunk
async function uploadChunk(file, chunkIndex, sessionId) {
  const start = chunkIndex * CHUNK_SIZE;
  const end = Math.min(start + CHUNK_SIZE, file.size);
  const chunk = file.slice(start, end);
  
  const formData = new FormData();
  formData.append('chunk', chunk);
  formData.append('chunkIndex', chunkIndex);
  formData.append('sessionId', sessionId);
  
  const response = await fetch('/upload/chunk', {
    method: 'POST',
    body: formData
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText);
  }
  
  return response.json();
}

// Complete the upload after all chunks are uploaded
async function completeUpload(sessionId, filename) {
  try {
    const response = await fetch('/upload/complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sessionId, filename })
    });
    
    if (!response.ok) {
      throw new Error('Failed to complete upload');
    }
    
    const result = await response.json();
    log(`Upload completed: ${filename}`);
    progressBar.style.width = '0%';
    fileInput.value = '';
    progressContainer.classList.add('hidden');
    
    // Refresh file list
    loadFiles();
  } catch (error) {
    log(`Failed to complete upload: ${error.message}`);
  }
}

// Format file size for display
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Fetch and display the list of available files with parallel download support
async function loadFiles() {
  try {
    const res = await fetch('/files');
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text);
    }
    const data = await res.json();
    fileList.innerHTML = '';
    if (data && Array.isArray(data.files) && data.files.length > 0) {
      data.files.forEach(file => {
        const li = document.createElement('li');
        li.textContent = file.name;
        const fileSize = document.createElement('span');
        fileSize.textContent = formatFileSize(file.size);
        fileSize.className = 'file-size';
        li.appendChild(fileSize);
        
        li.addEventListener('click', () => {
          downloadFile(file.name, file.size);
        });
        fileList.appendChild(li);
      });
    } else {
      log("No files available.");
    }
  } catch (err) {
    log("Error fetching file list: " + err.message);
  }
}

// Download file with parallel chunks
async function downloadFile(filename, fileSize) {
  try {
    log(`Starting download of ${filename}`);
    
    // Create download progress element
    const downloadProgressContainer = document.createElement('div');
    downloadProgressContainer.className = 'progress-container';
    const downloadProgressBar = document.createElement('div');
    downloadProgressBar.className = 'progress-bar';
    downloadProgressContainer.appendChild(downloadProgressBar);
    consoleDiv.appendChild(downloadProgressContainer);
    
    // Initialize download session
    const sessionRes = await fetch('/download/init', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filename: filename
      })
    });
    
    if (!sessionRes.ok) {
      throw new Error('Failed to initialize download session');
    }
    
    const { sessionId, totalChunks } = await sessionRes.json();
    
    // Prepare for parallel downloads
    const chunkPromises = [];
    const chunkData = new Array(totalChunks);
    let completedChunks = 0;
    
    // Function to update progress
    const updateDownloadProgress = () => {
      const percentComplete = Math.round((completedChunks / totalChunks) * 100);
      downloadProgressBar.style.width = percentComplete + '%';
      log(`Download progress: ${percentComplete}%`);
    };
    
    // Download chunks in parallel (limited by browser's max connections)
    for (let i = 0; i < totalChunks; i++) {
      const chunkPromise = fetch(`/download/chunk?sessionId=${sessionId}&chunkIndex=${i}`)
        .then(response => {
          if (!response.ok) throw new Error(`Failed to download chunk ${i}`);
          return response.arrayBuffer();
        })
        .then(arrayBuffer => {
          chunkData[i] = arrayBuffer;
          completedChunks++;
          updateDownloadProgress();
          return arrayBuffer;
        });
      
      chunkPromises.push(chunkPromise);
    }
    
    // Wait for all chunks to download
    await Promise.all(chunkPromises);
    
    // Combine chunks
    const completeFile = new Blob(chunkData);
    
    // Create download link
    const downloadUrl = URL.createObjectURL(completeFile);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    
    // Clean up
    setTimeout(() => {
      URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
      consoleDiv.removeChild(downloadProgressContainer);
    }, 100);
    
    log(`Download of ${filename} complete`);
  } catch (error) {
    log(`Download error: ${error.message}`);
  }
}

// Refresh button loads the file list.
refreshBtn.addEventListener('click', loadFiles);

// Initial load of file list.
loadFiles();
