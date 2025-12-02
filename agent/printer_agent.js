const { io } = require('socket.io-client');
const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, exec } = require('child_process');
require('dotenv').config();
const { print } = require("pdf-to-printer");

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const PRINTER_NAME = process.env.PRINTER_NAME || `Printer-${os.hostname()}`;
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(process.cwd(), 'downloads');

if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

function log(message, level = 'INFO') {
    const ts = new Date().toISOString().replace('T', ' ').substr(0, 19);
    console.log(`[${ts}] [${level}] ${message}`);
}

async function downloadPdf(fileUrl, jobId) {
    try {
        const fullUrl = fileUrl.startsWith('/') ? `${SERVER_URL}${fileUrl}` : fileUrl;
        log(`Downloading PDF from: ${fullUrl}`);

        const filepath = path.join(DOWNLOAD_DIR, `${jobId}.pdf`);
        const writer = fs.createWriteStream(filepath);

        const response = await axios({ url: fullUrl, method: 'GET', responseType: 'stream', timeout: 30_000 });
        await new Promise((resolve, reject) => {
            response.data.pipe(writer);
            let error = null;
            writer.on('error', err => {
                error = err;
                writer.close();
                reject(err);
            });
            writer.on('close', () => {
                if (!error) resolve();
            });
        });

        log(`PDF downloaded successfully: ${filepath}`);
        return filepath;
    } catch (err) {
        log(`Failed to download PDF: ${err.message}`, 'ERROR');
        return null;
    }
}

async function printPdf(filePath) {
    try {
        console.log(`Printing file: ${filePath}`);

        await print(filePath); // use the default printer

        console.log("Print job sent successfully");
        return true;
    } catch (error) {
        console.error("Printing failed:", error.message);
        return false;
    }
}

function createSocket() {
    // connect socket
    const socket = io(`${SERVER_URL}/connectprinter`, {
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        transports: ['websocket'],
    });

    socket.on('connect', () => {
        log(`✓ Connected to server: ${SERVER_URL}`, 'SUCCESS');
        socket.emit('printer-registered', {
            printerName: PRINTER_NAME,
            platform: os.type(),
            hostname: os.hostname()
        });
        log(`Printer registered: ${PRINTER_NAME}`, 'SUCCESS');
    });

    socket.on('disconnect', (reason) => {
        log(`Disconnected from server (${reason})`, 'WARNING');
    });

    socket.on('connect_error', (err) => {
        log(`Connection error: ${err && err.message ? err.message : err}`, 'ERROR');
    });

    socket.on('new-print-job', async (data) => {
        const jobId = data.jobId;
        const printerName = data.printerName;
        const fileUrl = data.fileUrl;
        const filename = data.filename;

        log('═'.repeat(60));
        log('📄 New print job received!', 'INFO');
        log(`   Job ID: ${jobId}`);
        log(`   Printer: ${printerName}`);
        log(`   File: ${filename}`);
        log('═'.repeat(60));

        if (printerName && printerName !== PRINTER_NAME) {
            log(`Job is for different printer (${printerName}), ignoring`, 'INFO');
            return;
        }

        // Update status to processing
        socket.emit('job-status-update', { jobId, status: 'processing' });

        // Download
        const filepath = await downloadPdf(fileUrl, jobId);
        if (!filepath) {
            socket.emit('job-status-update', { jobId, status: 'failed' });
            return;
        }

        // Print
        const success = await printPdf(filepath);

        // Update final status
        if (success) {
            socket.emit('job-status-update', { jobId, status: 'completed' });
            log('✓ Print job completed successfully!', 'SUCCESS');
        } else {
            socket.emit('job-status-update', { jobId, status: 'failed' });
            log('✗ Print job failed', 'ERROR');
        }

        log('═'.repeat(60));
    });

    return socket;
}

async function main() {
    console.log('\n');
    console.log('╔════════════════════════════════════════╗');
    console.log('║      Cloud Printer Agent Started      ║');
    console.log('╠════════════════════════════════════════╣');
    console.log(`║  Server: ${SERVER_URL.padEnd(28)} ║`);
    console.log(`║  Printer: ${PRINTER_NAME.padEnd(27)} ║`);
    console.log(`║  Platform: ${os.type().padEnd(26)} ║`);
    console.log('╚════════════════════════════════════════╝');
    console.log('\n');

    log('Connecting to server...');
    const socket = createSocket();

    process.on('SIGINT', async () => {
        log('Shutting down agent...', 'WARNING');
        try {
            socket.disconnect();
        } catch (err) {
            // ignore
        }
        log('Agent stopped', 'INFO');
        process.exit(0);
    });
}

if (require.main === module) {
    main().catch(err => {
        log(`Fatal error: ${err && err.message ? err.message : err}`, 'ERROR');
        process.exit(1);
    });
}
