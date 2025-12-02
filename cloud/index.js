import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import multer from 'multer';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import PrintJob from './models/PrintJob.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const printerIO = io.of('/connectprinter');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// DB Connection
const MONGODB_URI = process.env.DB_URL;
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✓ MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Upload file
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only PDF files are allowed!'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
});


app.get('/', (req, res) => {
  res.render('index');
});

// upload the pdf
app.post('/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    const { printerName } = req.body;
    
    if (!printerName) {
      return res.status(400).json({ error: 'Printer name is required' });
    }

    const printJob = new PrintJob({
      filename: req.file.filename,
      originalName: req.file.originalname,
      filePath: req.file.path,
      fileUrl: `/uploads/${req.file.filename}`,
      printerName: printerName,
      status: 'pending',
      uploadedAt: new Date()
    });

    await printJob.save();

    // emit message to socket to printer
    printerIO.emit('new-print-job', {
      jobId: printJob._id,
      printerName: printerName,
      fileUrl: printJob.fileUrl,
      filename: printJob.originalName,
      filePath: path.join(__dirname, printJob.filePath)
    });

    console.log(`New print job created for printer: ${printerName}`);
    console.log(`File: ${printJob.originalName}`);
    console.log(`Job ID: ${printJob._id}`);

    res.json({
      success: true,
      message: 'PDF uploaded successfully and sent to printer',
      jobId: printJob._id,
      printer: printerName,
      filename: printJob.originalName
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      error: 'Failed to upload PDF',
      details: error.message 
    });
  }
});

app.get('/api/jobs', async (req, res) => {
  try {
    const jobs = await PrintJob.find().sort({ uploadedAt: -1 }).limit(50);
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// update status
app.put('/api/jobs/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const job = await PrintJob.findByIdAndUpdate(
      req.params.id,
      { status, updatedAt: new Date() },
      { new: true }
    );
    res.json(job);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update job status' });
  }
});


// socket connection
printerIO.on('connection', (socket) => {
  console.log('✓ Printer agent connected:', socket.id);

  socket.on('printer-registered', (data) => {
    console.log(`✓ Printer registered: ${data.printerName}`);
  });

  socket.on('job-status-update', async (data) => {
    console.log(`Status update for job ${data.jobId}: ${data.status}`);
    try {
      await PrintJob.findByIdAndUpdate(data.jobId, { 
        status: data.status,
        updatedAt: new Date()
      });
    } catch (error) {
      console.error('Failed to update job status:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('✗ Printer agent disconnected:', socket.id);
  });
});



app.use('/uploads', express.static('uploads'));


// start server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║     Cloud Printer System Started       ║
╠════════════════════════════════════════╣
║  Server: http://localhost:${PORT}         ║
║  Status: Ready to accept print jobs    ║
╚════════════════════════════════════════╝
  `);
});
