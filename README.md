# NeuroShare

**NeuroShare** is an open-source, secure, and efficient file-sharing web application that leverages FTPS (FTP over TLS) to provide fast, encrypted file transfers. With its sleek blue-themed interface, NeuroShare allows users to easily upload (send) and download (receive) files across devices on the same network.

## Features

- **Secure Transfers:** Files are transferred over FTPS with TLS encryption.
- **Fast File Sharing:** Supports quick uploads and downloads with potential enhancements like parallel transfers and file splitting.
- **User-Friendly Interface:** Clean, blue-themed web interface for effortless file sending and receiving.
- **Real-Time Logging:** Live logging of backend activities using Socket.IO.
- **Open Source:** Contributions and improvements are welcome!

## Project Structure

```
neuroshare-production/
├── ftp/                # Contains TLS certificate and key files.
│   ├── cert.pem        # TLS certificate.
│   └── key.pem         # TLS private key.
├── shared/             # Directory where uploaded files are stored.
├── temp/               # Temporary folder for FTP downloads.
├── public/             # Contains front-end files.
│   ├── index.html      # Main web page.
│   ├── style.css       # Blue-themed stylesheet.
│   └── client.js       # Client-side JavaScript.
├── package.json        # Project manifest with dependencies and scripts.
└── server.js           # Main server file (Express + FTPS server).
```

## Requirements

- **Node.js and npm:** Ensure you have Node.js (and npm) installed.
- **TLS Certificates:** A TLS certificate and key must be placed in the `ftp/` directory. For testing, self-signed certificates can be generated.
- **Git:** For version control and contributions.

## Installation

1. **Clone the Repository:**

   ```bash
   git clone https://github.com/aryadityad/NeuroShare.git
   cd NeuroShare
   ```

2. **Install Dependencies:**

   ```bash
   npm install
   ```

3. **Generate TLS Certificates (if needed):**

   If you don't have a certificate and key, you can generate self-signed ones for testing. In the `ftp` directory, run:

   ```bash
   cd ftp
   openssl req -x509 -newkey rsa:4096 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/C=US/ST=State/L=City/O=NeuroShare/CN=localhost"
   cd ..
   ```

## Running the Application

Start the server with:

```bash
npm start
```

- The HTTP server will run on port **3000**.
- The FTPS server will run on port **2121**.
- Open your browser and navigate to [http://localhost:3000](http://localhost:3000) to access the NeuroShare web interface.

## Usage

### Sending Files

1. In the "Send File" section, select a file using the file input.
2. Click **Upload & Share**.
3. The file will be uploaded to the `shared/` directory and become available for download.

### Receiving Files

1. In the "Receive File" section, click **Refresh File List** to view available files.
2. Click on a file name to download it securely via FTPS.
3. The download will either start automatically or prompt you to save the file.

### Real-Time Logging

The web interface includes a console area that displays live log messages. These logs help you monitor uploads, downloads, and other backend activities.

## Testing

### Manual Testing

- **Local Testing:** Run `npm start` and use [http://localhost:3000](http://localhost:3000) to test file uploads and downloads.
- **Multi-Device Testing:** Connect other devices on the same network (e.g., via your computer's IP address) to verify cross-device functionality.

### Automated Testing (Optional)

To set up automated tests, you can use frameworks like Mocha, Chai, and Supertest. For example:

1. **Install Testing Tools:**

   ```bash
   npm install --save-dev mocha chai supertest
   ```

2. **Create a Test Directory and File:**

   ```bash
   mkdir test
   nano test/api.test.js
   ```

3. **Sample Test Content:**

   ```javascript
   const request = require('supertest');
   const expect = require('chai').expect;
   const app = require('../server'); // Ensure your server exports the Express app

   describe('GET /files', () => {
     it('should return a list of files', (done) => {
       request(app)
         .get('/files')
         .expect(200)
         .end((err, res) => {
           if (err) return done(err);
           expect(res.body).to.have.property('files');
           done();
         });
     });
   });
   ```

4. **Add a Test Script to package.json:**

   ```json
   "scripts": {
     "start": "node server.js",
     "test": "mocha"
   }
   ```

5. **Run the Tests:**

   ```bash
   npm test
   ```

## Contributing

Contributions are welcome! To contribute:

1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Commit your changes and push your branch.
4. Open a pull request describing your changes.

For major changes, please open an issue first to discuss what you would like to change.

## License

This project is open-source and available under the [MIT License](LICENSE).

## Contact

**Aryaditya Deshmukh**  
Feel free to open issues or contact me for suggestions and improvements.
```

---

This complete `README.md` provides an overview of NeuroShare, explains its features and structure, and offers clear instructions on installation, usage, testing, and contributing. Enjoy developing NeuroShare!
