const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Config
const URL = 'http://localhost:3000';
const INPUT_FILE = "C:/Users/Hp/.gemini/antigravity/brain/3d36ada2-c96c-4e7a-b702-0356b6ee0f10/uploaded_image_1768556661496.png";

// Helper to sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runTest() {
    console.log("=== Starting Deletion Verification ===");

    // 1. Snapshot Initial State
    const uploadDir = path.join(__dirname, 'temp', 'uploads');
    const processedDir = path.join(__dirname, 'temp', 'processed');

    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    if (!fs.existsSync(processedDir)) fs.mkdirSync(processedDir, { recursive: true });

    const initialUploads = fs.readdirSync(uploadDir);
    console.log(`Initial Uploads: ${initialUploads.length}`);

    // 2. Upload File via Curl
    console.log("-> Uploading file...");
    const curl = spawn('curl', [
        '-s',
        '-F', 'targetSizeKB=50',
        '-F', `file=@${INPUT_FILE}`,
        `${URL}/upload`
    ]);

    let responseData = '';
    curl.stdout.on('data', d => responseData += d);

    await new Promise(resolve => curl.on('close', resolve));

    let result;
    try {
        result = JSON.parse(responseData);
        console.log("-> Upload success. ID:", result.id);
    } catch (e) {
        console.error("Upload failed:", responseData);
        return;
    }

    // 3. Verify Original Deleted
    // Give it a split second just in case FS is slightly lagging, but logic is synchronous in server.js usually
    await sleep(500);
    const currentUploads = fs.readdirSync(uploadDir);
    const newUploads = currentUploads.filter(f => !initialUploads.includes(f));

    if (newUploads.length === 0) {
        console.log("✅ PASSED: Original file deleted immediately.");
    } else {
        console.error("❌ FAILED: Original file still exists:", newUploads);
    }

    // 4. Verify Processed Exists
    const processedPath = path.join(processedDir, result.id);
    if (fs.existsSync(processedPath)) {
        console.log("✅ PASSED: Processed file exists (waiting for download).");
    } else {
        console.error("❌ FAILED: Processed file missing before download!");
        return;
    }

    // 5. Download File
    console.log("-> Downloading file...");
    const curlDownload = spawn('curl', [
        '-s',
        '-o', 'downloaded_test.png',
        `${URL}/download/${result.id}`
    ]);
    await new Promise(resolve => curlDownload.on('close', resolve));

    // 6. Verify Processed Deleted
    await sleep(500); // Give FS time to unlink
    if (!fs.existsSync(processedPath)) {
        console.log("✅ PASSED: Processed file deleted immediately after download.");
    } else {
        console.error("❌ FAILED: Processed file still exists after download.");
    }

    // Cleanup local test file
    if (fs.existsSync('downloaded_test.png')) fs.unlinkSync('downloaded_test.png');
}

runTest();
