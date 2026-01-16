const fs = require('fs');

/**
 * Delete a file safely.
 */
function deleteFile(filePath) {
    if (!filePath) return;

    fs.unlink(filePath, (err) => {
        if (err && err.code !== 'ENOENT') {
            console.error(`Error deleting file ${filePath}:`, err);
        }
    });
}

/**
 * Delete multiple files
 */
function deleteFiles(filePaths) {
    filePaths.forEach(deleteFile);
}

module.exports = { deleteFile, deleteFiles };
