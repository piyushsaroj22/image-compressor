const sharp = require('sharp');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Compress Image using Sharp
 * Iteratively attempts to reach targetSizeKB if provided.
 */
async function compressImage(inputPath, outputDir, targetSizeKB = null) {
    const filename = path.basename(inputPath);
    const outputPath = path.join(outputDir, filename);

    const metadata = await sharp(inputPath).metadata();
    const format = metadata.format;

    // Initial resize if huge
    let inputBuffer;
    if (metadata.width > 4000 || metadata.height > 4000) {
        inputBuffer = await sharp(inputPath).resize({ width: 4000, height: 4000, fit: 'inside' }).toBuffer();
    } else {
        inputBuffer = await sharp(inputPath).toBuffer();
    }

    return await compressBufferRecursive(inputBuffer, outputPath, format, targetSizeKB);
}

async function compressBufferRecursive(input, outputPath, format, targetSizeKB) {
    if (!targetSizeKB) {
        // Standard processing if no target
        let pipeline = sharp(input);
        if (format === 'jpeg' || format === 'jpg') pipeline = pipeline.jpeg({ quality: 70, mozjpeg: true });
        else if (format === 'png') pipeline = pipeline.png({ compressionLevel: 8, palette: true });
        else if (format === 'webp') pipeline = pipeline.webp({ quality: 65 });
        await pipeline.toFile(outputPath);
        return outputPath;
    }

    const targetBytes = targetSizeKB * 1024;
    console.log(`Target: ${targetSizeKB}KB (${targetBytes} bytes) for ${path.basename(outputPath)}`);

    let currentBuffer = input;
    if (!Buffer.isBuffer(input)) {
        currentBuffer = await sharp(input).toBuffer();
    }

    // Attempt 1: Lowest Quality at Original Resolution
    const getBuffer = async (buf, w, q) => {
        let p = sharp(buf);
        if (w) p = p.resize({ width: w, fit: 'inside' });

        if (format === 'png') {
            p = p.png({ quality: q, compressionLevel: 9, palette: true });
        } else if (format === 'webp') {
            p = p.webp({ quality: q });
        } else {
            p = p.jpeg({ quality: q, mozjpeg: true });
        }
        return p.toBuffer();
    };

    // Try Quality 1 (Absolute lowest)
    const lowQBuffer = await getBuffer(currentBuffer, null, 1);
    if (lowQBuffer.length <= targetBytes) {
        // Fits! Optimize quality.
        let l = 1, r = 100;
        let bestQ = 1;
        let bestBuffer = lowQBuffer;

        while (l <= r) {
            const mid = Math.floor((l + r) / 2);
            const buf = await getBuffer(currentBuffer, null, mid);
            if (buf.length <= targetBytes) {
                bestBuffer = buf;
                bestQ = mid;
                l = mid + 1;
            } else {
                r = mid - 1;
            }
        }
        fs.writeFileSync(outputPath, bestBuffer);
        return outputPath;
    }

    // Attempt 2: Resize Loop (Unlimited)
    console.log(`Quality 1 size ${lowQBuffer.length} > ${targetBytes}. Entering Unlimited Resize Loop.`);
    let meta = await sharp(currentBuffer).metadata();
    let width = meta.width;
    let bestBuffer = null;

    // Loop until fits
    while (true) {
        width = Math.floor(width * 0.70);
        if (width < 1) width = 1;

        const buf = await getBuffer(currentBuffer, width, 50);

        if (buf.length <= targetBytes) {
            // Fits! Optimize quality.
            let l = 1, r = 100;
            let finalBuf = buf;
            while (l <= r) {
                const mid = Math.floor((l + r) / 2);
                const b = await getBuffer(currentBuffer, width, mid);
                if (b.length <= targetBytes) {
                    finalBuf = b;
                    l = mid + 1;
                } else {
                    r = mid - 1;
                }
            }
            bestBuffer = finalBuf;
            break;
        } else {
            const bufLow = await getBuffer(currentBuffer, width, 1);
            if (bufLow.length <= targetBytes) {
                bestBuffer = bufLow;
                break;
            }
        }

        if (width === 1) {
            bestBuffer = await getBuffer(currentBuffer, 1, 1);
            break;
        }
    }

    fs.writeFileSync(outputPath, bestBuffer);
    console.log(`Final Size: ${bestBuffer.length}`);
    return outputPath;
}

/**
 * Compress PDF using Ghostscript
 * Iteratively attempts to reach targetSizeKB.
 */
async function compressPdf(inputPath, outputDir, targetSizeKB = null) {
    const filename = path.basename(inputPath);
    const outputPath = path.join(outputDir, filename);

    const gsStatus = await checkGhostscript();
    if (!gsStatus) {
        console.warn('Ghostscript not found. Copying file.');
        fs.copyFileSync(inputPath, outputPath);
        return outputPath;
    }

    const runGs = (args) => {
        return new Promise((resolve, reject) => {
            const gs = spawn(gsStatus, args);
            gs.on('close', code => code === 0 ? resolve() : reject(new Error(`GS code ${code}`)));
            gs.on('error', reject);
        });
    };

    const strategies = [
        { name: 'ebook', args: ['-dPDFSETTINGS=/ebook'] },
        { name: 'screen', args: ['-dPDFSETTINGS=/screen'] },
        {
            name: 'low-res', args: [
                '-dPDFSETTINGS=/screen',
                '-dColorImageResolution=50',
                '-dGrayImageResolution=50',
                '-dMonoImageResolution=50',
                '-dDownsampleColorImages=true',
                '-dDownsampleGrayImages=true',
                '-dDownsampleMonoImages=true'
            ]
        }
    ];

    if (!targetSizeKB) {
        try {
            await runGs([
                '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.4',
                '-dPDFSETTINGS=/screen', '-dNOPAUSE', '-dQUIET', '-dBATCH',
                `-sOutputFile=${outputPath}`, inputPath
            ]);
            return outputPath;
        } catch (e) {
            console.error('GS Error:', e);
            fs.copyFileSync(inputPath, outputPath);
            return outputPath;
        }
    }

    const targetBytes = targetSizeKB * 1024;
    console.log(`PDF Target: ${targetSizeKB}KB (${targetBytes} bytes)`);

    for (let i = 0; i < strategies.length; i++) {
        const strat = strategies[i];
        console.log(`Attempting PDF Strategy: ${strat.name}`);

        try {
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

            const args = [
                '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.4',
                ...strat.args,
                '-dNOPAUSE', '-dQUIET', '-dBATCH',
                `-sOutputFile=${outputPath}`, inputPath
            ];

            await runGs(args);

            if (fs.existsSync(outputPath)) {
                const stats = fs.statSync(outputPath);
                console.log(`PDF Size after ${strat.name}: ${stats.size} bytes`);
                if (stats.size <= targetBytes) {
                    console.log('PDF Validation Passed.');
                    return outputPath;
                }
            }
        } catch (err) {
            console.error(`PDF Strategy ${strat.name} failed:`, err);
        }
    }

    // Fallback
    if (!fs.existsSync(outputPath)) {
        fs.copyFileSync(inputPath, outputPath);
    }
    return outputPath;
}

async function checkGhostscript() {
    const cmds = ['gswin64c', 'gswin32c', 'gs'];
    for (const cmd of cmds) {
        try {
            await new Promise((resolve, reject) => {
                const check = spawn(cmd, ['--version']);
                check.on('error', reject);
                check.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject();
                });
            });
            return cmd;
        } catch (e) {
            continue;
        }
    }
    return null;
}

module.exports = { compressImage, compressPdf };
