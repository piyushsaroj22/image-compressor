const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');
const { compressImage, compressPdf } = require('./compression');
const { deleteFile, deleteFiles } = require('./cleanup');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Configure Paths
const UPLOAD_DIR = path.join(__dirname, 'temp', 'uploads');
const PROCESSED_DIR = path.join(__dirname, 'temp', 'processed');

// Ensure directories exist
const dirs = [UPLOAD_DIR, PROCESSED_DIR];
dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Multer Storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${uuidv4()}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Upload & Compress Endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        const inputPath = req.file.path;
        let processedPath;
        const targetSizeKB = req.body.targetSizeKB ? parseFloat(req.body.targetSizeKB) : null;

        if (req.file.mimetype === 'application/pdf') {
            processedPath = await compressPdf(inputPath, PROCESSED_DIR, targetSizeKB);
        } else if (req.file.mimetype.startsWith('image/')) {
            processedPath = await compressImage(inputPath, PROCESSED_DIR, targetSizeKB);
        } else {
            deleteFile(inputPath);
            return res.status(400).json({ error: 'Unsupported file type' });
        }

        const originalStats = fs.statSync(inputPath);
        const processedStats = fs.statSync(processedPath);

        // Delete Original Upload Immediately
        deleteFile(inputPath);

        res.json({
            id: path.basename(processedPath),
            originalName: req.file.originalname,
            originalSize: originalStats.size,
            compressedSize: processedStats.size,
            status: 'done'
        });

    } catch (err) {
        console.error('Processing Error:', err);
        if (req.file) deleteFile(req.file.path);
        res.status(500).json({ error: 'Processing failed' });
    }
});

// Download Single File Endpoint
app.get('/download/:id', (req, res) => {
    const filename = req.params.id;
    const filePath = path.join(PROCESSED_DIR, filename);
    const userFilename = req.query.name || filename;

    if (!fs.existsSync(filePath)) {
        return res.status(404).send('File not found or already deleted.');
    }

    res.download(filePath, userFilename, (err) => {
        if (!err) {
            // Delete after successful download
            deleteFile(filePath);
        }
    });
});

// Stream ZIP Endpoint
app.post('/stream-zip', async (req, res) => {
    let fileIds = [];
    try {
        fileIds = JSON.parse(req.body.fileIds || '[]');
    } catch (e) {
        fileIds = [];
    }

    if (!fileIds || fileIds.length === 0) {
        return res.status(400).send('No files specified');
    }

    const archive = archiver('zip', { zlib: { level: 9 } });

    res.attachment('compressed-files.zip');
    archive.pipe(res);

    const filesToDelete = [];

    fileIds.forEach(id => {
        const filePath = path.join(PROCESSED_DIR, id);
        if (fs.existsSync(filePath)) {
            archive.file(filePath, { name: id });
            filesToDelete.push(filePath);
        }
    });

    archive.on('end', () => {
        setTimeout(() => {
            deleteFiles(filesToDelete);
        }, 1000);
    });

    archive.on('error', (err) => {
        console.error('Archive error:', err);
        if (!res.headersSent) res.status(500).send({ error: err.message });
    });

    archive.finalize();
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);

    // Auto-Cleanup: Delete processed files older than 2 minutes
    setInterval(() => {
        console.log('Running auto-cleanup...');
        const now = Date.now();
        const maxAge = 2 * 60 * 1000; // 2 mins

        fs.readdir(PROCESSED_DIR, (err, files) => {
            if (err) return;
            files.forEach(file => {
                const filePath = path.join(PROCESSED_DIR, file);
                fs.stat(filePath, (err, stats) => {
                    if (err) return;
                    if (now - stats.mtimeMs > maxAge) {
                        deleteFile(filePath);
                        console.log(`Auto-deleted old file: ${file}`);
                    }
                });
            });
        });

        // Also clean uploads if any stuck
        fs.readdir(UPLOAD_DIR, (err, files) => {
            if (err) return;
            files.forEach(file => {
                const filePath = path.join(UPLOAD_DIR, file);
                fs.stat(filePath, (err, stats) => {
                    if (err) return;
                    if (now - stats.mtimeMs > maxAge) {
                        deleteFile(filePath);
                    }
                });
            });
        });

    }, 60 * 1000); // Check every 1 minute
});
