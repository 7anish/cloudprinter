import mongoose from 'mongoose';

const printJobSchema = new mongoose.Schema({
  filename: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  filePath: {
    type: String,
    required: true
  },
  fileUrl: {
    type: String,
    required: true
  },
  printerName: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'printing', 'completed', 'failed'],
    default: 'pending'
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

const PrintJob = mongoose.model('PrintJob', printJobSchema);

export default PrintJob;
