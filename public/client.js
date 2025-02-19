const socket = io();
const consoleDiv = document.getElementById('console');
const uploadForm = document.getElementById('uploadForm');
const fileInput = document.getElementById('fileInput');
const refreshBtn = document.getElementById('refreshBtn');
const fileList = document.getElementById('fileList');
const progressContainer = document.getElementById('uploadProgressContainer');
const progressBar = document.getElementById('uploadProgress');

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

// Handle file upload using XMLHttpRequest for progress tracking.
uploadForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const file = fileInput.files[0];
  if (!file) {
    log("Please select a file to upload.");
    return;
  }
  
  const formData = new FormData();
  formData.append('file', file);
  
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/upload');
  
  xhr.upload.addEventListener('progress', (event) => {
    if (event.lengthComputable) {
      const percentComplete = Math.round((event.loaded / event.total) * 100);
      progressBar.style.width = percentComplete + '%';
    }
  });
  
  xhr.onreadystatechange = function() {
    if (xhr.readyState === XMLHttpRequest.DONE) {
      progressBar.style.width = '0%';
      fileInput.value = '';
      if (xhr.status === 200) {
        const response = JSON.parse(xhr.responseText);
        if (response.success) {
          log(`Uploaded: ${file.name}`);
          loadFiles();
        } else {
          log("Upload failed: " + response.message);
        }
      } else {
        log("Error uploading file: " + xhr.responseText);
      }
    }
  };
  
  progressContainer.classList.remove('hidden');
  xhr.send(formData);
});

// Fetch and display the list of available files.
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
        li.textContent = file;
        li.addEventListener('click', () => {
          window.location.href = `/download?file=${encodeURIComponent(file)}`;
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

// Refresh button loads the file list.
refreshBtn.addEventListener('click', loadFiles);

// Initial load of file list.
loadFiles();
