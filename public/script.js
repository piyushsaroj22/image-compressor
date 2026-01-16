document.addEventListener('DOMContentLoaded', () => {
    // --- State ---
    let files = [];
    let isProcessing = false;
    const MAX_FILES = 200;
    const CONCURRENT_UPLOADS = 5;

    // --- DOM Elements ---
    const views = {
        landing: document.getElementById('landing-view'),
        fileList: document.getElementById('file-list-view'),
        processing: document.getElementById('processing-view'),
        results: document.getElementById('results-view')
    };

    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileListContainer = document.getElementById('file-list-container');
    const resultsListContainer = document.getElementById('results-list-container');
    const totalFilesCount = document.getElementById('total-files-count');

    // Buttons
    const compressBtn = document.getElementById('compress-btn');
    const addMoreBtn = document.getElementById('add-more-btn');
    const clearAllBtn = document.getElementById('clear-all-btn');
    const downloadAllBtn = document.getElementById('download-all-btn');
    const compressMoreBtn = document.getElementById('compress-more-btn');

    // Templates
    const fileTemplate = document.getElementById('file-item-template');
    const resultTemplate = document.getElementById('result-item-template');

    // Progress
    const globalProgressBar = document.getElementById('global-progress-bar');
    const processingStatusText = document.getElementById('processing-status-text');

    // --- Event Listeners ---

    // Navigation/Actions
    addMoreBtn.addEventListener('click', () => fileInput.click());
    clearAllBtn.addEventListener('click', () => {
        if (confirm('Clear all files?')) {
            files = [];
            updateViews();
        }
    });

    compressMoreBtn.addEventListener('click', () => {
        files = [];
        updateViews();
    });

    compressBtn.addEventListener('click', startCompression);

    downloadAllBtn.addEventListener('click', async () => {
        // Collect all processed IDs
        const processedIds = files.filter(f => f.status === 'done').map(f => f.result.id);
        if (processedIds.length === 0) return;

        // Trigger ZIP generation
        // We'll send a POST request to get the ZIP stream
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = '/stream-zip';
        form.style.display = 'none';

        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'fileIds';
        input.value = JSON.stringify(processedIds);

        form.appendChild(input);
        document.body.appendChild(form);
        form.submit();
        document.body.removeChild(form);
    });

    // File Input / Drag & Drop
    dropZone.addEventListener('click', (e) => {
        // Prevent default click if clicking on inner elements, except input
        if (e.target !== fileInput) fileInput.click();
    });

    fileInput.addEventListener('change', handleFileSelect);

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, unhighlight, false);
    });

    function highlight() { dropZone.classList.add('drag-over'); }
    function unhighlight() { dropZone.classList.remove('drag-over'); }

    dropZone.addEventListener('drop', handleDrop, false);

    function handleDrop(e) {
        const dt = e.dataTransfer;
        handleFiles(dt.files);
    }

    function handleFileSelect(e) {
        handleFiles(e.target.files);
        fileInput.value = ''; // Reset
    }

    function handleFiles(fileList) {
        if (files.length + fileList.length > MAX_FILES) {
            alert(`You can only upload up to ${MAX_FILES} files.`);
            return;
        }

        const newFiles = Array.from(fileList).map(f => ({
            id: Math.random().toString(36).substr(2, 9),
            file: f,
            status: 'pending', // pending, processing, done, error
            result: null
        }));

        files = [...files, ...newFiles];
        updateViews();
    }

    // --- View Logic ---
    function updateViews() {
        // Determine active view
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.querySelectorAll('.view').forEach(v => {
            // For smooth transition logic, we might want to keep the class logic simple
            v.style.display = 'none';
        });

        const show = (el) => {
            el.style.display = 'flex';
            setTimeout(() => el.classList.add('active'), 10);
        };

        if (isProcessing) {
            show(views.processing);
            return;
        }

        if (files.length === 0) {
            show(views.landing);
        } else {
            // Check if all done
            const allDone = files.length > 0 && files.every(f => f.status === 'done' || f.status === 'error');
            if (allDone) {
                renderResults();
                show(views.results);
            } else {
                renderFileList();
                show(views.fileList);
            }
        }
    }

    function renderFileList() {
        fileListContainer.innerHTML = '';
        totalFilesCount.textContent = files.length;

        files.forEach(f => {
            const clone = fileTemplate.content.cloneNode(true);
            const el = clone.querySelector('.file-item');

            // Name
            el.querySelector('.file-name').textContent = f.file.name;

            // Size
            el.querySelector('.file-size').textContent = formatBytes(f.file.size);

            // Type
            const typeText = f.file.type.includes('pdf') ? 'PDF' : 'IMAGE';
            el.querySelector('.file-type').textContent = typeText;

            // Preview (Simple logic: if image, show it)
            const previewEl = el.querySelector('.file-preview');
            if (f.file.type.startsWith('image/')) {
                const url = URL.createObjectURL(f.file);
                previewEl.style.backgroundImage = `url(${url})`;
                previewEl.textContent = '';
                // Note: revoking object URL should happen later to save memory
            } else {
                previewEl.textContent = '📄';
            }

            // Remove
            const removeBtn = el.querySelector('.remove-btn');
            removeBtn.addEventListener('click', () => {
                files = files.filter(item => item.id !== f.id);
                updateViews();
            });

            fileListContainer.appendChild(el);
        });
    }

    function renderResults() {
        resultsListContainer.innerHTML = '';
        files.forEach(f => {
            if (f.status === 'error') return; // Skip failed for now or show error

            const clone = resultTemplate.content.cloneNode(true);
            const el = clone.querySelector('.result-item');

            el.querySelector('.file-name').textContent = f.file.name;

            const original = f.result.originalSize;
            const compressed = f.result.compressedSize;
            const percent = ((original - compressed) / original * 100).toFixed(1);

            el.querySelector('.new-size').textContent = formatBytes(compressed);
            el.querySelector('.reduction-badge').textContent = `-${percent}%`;

            // Download Link
            const dlBtn = el.querySelector('.download-btn-icon');
            dlBtn.href = `/download/${f.result.id}?name=${encodeURIComponent(f.file.name)}`; // Using name param for pretty filename

            // Preview (Same as before)
            const previewEl = el.querySelector('.file-preview');
            if (f.file.type.startsWith('image/')) {
                const url = URL.createObjectURL(f.file);
                previewEl.style.backgroundImage = `url(${url})`;
                previewEl.textContent = '';
            } else {
                previewEl.textContent = '📄';
            }

            resultsListContainer.appendChild(el);
        });
    }

    // --- Compression Logic ---
    async function startCompression() {
        isProcessing = true;
        updateViews();

        const queue = files.filter(f => f.status === 'pending');
        let completed = 0;

        // Get Target Size
        const targetSizeVal = document.getElementById('target-size-input').value;
        const targetSizeUnit = document.getElementById('target-size-unit').value;
        let targetSizeKB = null;

        if (targetSizeVal && !isNaN(targetSizeVal)) {
            targetSizeKB = parseFloat(targetSizeVal);
            if (targetSizeUnit === 'MB') targetSizeKB *= 1024;
        }

        // Process function (one file)
        const processFile = async (fileObj) => {
            try {
                fileObj.status = 'processing';
                const formData = new FormData();
                // Important: Append text fields BEFORE file for Multer to process them correctly if using streaming/limits
                if (targetSizeKB) {
                    formData.append('targetSizeKB', targetSizeKB);
                }
                formData.append('file', fileObj.file);

                const res = await fetch('/upload', {
                    method: 'POST',
                    body: formData
                });

                if (!res.ok) throw new Error('Failed');

                const data = await res.json();
                fileObj.status = 'done';
                fileObj.result = data;

            } catch (err) {
                console.error(err);
                fileObj.status = 'error';
            } finally {
                completed++;
                updateProgress(completed, queue.length);
            }
        };

        // Batch Queue
        // We'll run batches of CONCURRENT_UPLOADS
        for (let i = 0; i < queue.length; i += CONCURRENT_UPLOADS) {
            const batch = queue.slice(i, i + CONCURRENT_UPLOADS);
            await Promise.all(batch.map(processFile));
        }

        isProcessing = false;
        updateViews();
    }

    function updateProgress(done, total) {
        const percent = Math.round((done / total) * 100);
        globalProgressBar.style.width = `${percent}%`;
        processingStatusText.textContent = `Processing ${done} of ${total} files`;
    }

    // Utils
    function formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }
});
