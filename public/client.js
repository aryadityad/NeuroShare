const socket = io();
const consoleDiv = document.getElementById('console');
const uploadForm = document.getElementById('uploadForm');
const fileInput = document.getElementById('fileInput');
const refreshBtn = document.getElementById('refreshBtn');
const fileList = document.getElementById('fileList');

// Append a log message to the console area.
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

// Handle file upload.
uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = fileInput.files[0];
  if (!file) {
    log("Please select a file to upload.");
    return;
  }
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const res = await fetch('/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      log(`Uploaded: ${file.name}`);
      fileInput.value = '';
      loadFiles();
    } else {
      log("Upload failed.");
    }
  } catch (err) {
    log("Error uploading file: " + err.message);
  }
});

// Fetch and display the list of available files.
async function loadFiles() {
  try {
    const res = await fetch('/files');
    const data = await res.json();
    fileList.innerHTML = '';
    data.files.forEach(file => {
      const li = document.createElement('li');
      li.textContent = file;
      li.addEventListener('click', () => {
        // Initiate file download when clicked.
        window.location.href = `/download?file=${encodeURIComponent(file)}`;
      });
      fileList.appendChild(li);
    });
  } catch (err) {
    log("Error fetching file list: " + err.message);
  }
}

// Refresh button loads the file list.
refreshBtn.addEventListener('click', loadFiles);

// Initial load of file list.
loadFiles();
