const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

// Supported categories and conversion commands
const getConversionCommand = (sourcePath, targetPath, sourceExt, targetExt, category) => {
  if (category === 'image') {
    // Use ImageMagick for images
    return `convert "${sourcePath}" "${targetPath}"`;
  } else if (category === 'document') {
    // Use LibreOffice for documents
    return `libreoffice --headless --convert-to ${targetExt} --outdir "${path.dirname(targetPath)}" "${sourcePath}"`;
  } else if (category === 'audio' || category === 'video') {
    // Use FFmpeg for audio/video
    return `ffmpeg -i "${sourcePath}" "${targetPath}"`;
  }
  throw new Error('Unsupported file category');
};

// Get category from extension (matching your frontend FORMATS)
const getFileCategory = (ext) => {
  const lowerExt = ext.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'].includes(lowerExt)) return 'image';
  if (['pdf', 'docx', 'doc', 'odt', 'txt', 'rtf'].includes(lowerExt)) return 'document';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(lowerExt)) return 'audio';
  if (['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv'].includes(lowerExt)) return 'video';
  return null;
};

// Conversion endpoint
app.post('/convert', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const sourcePath = req.file.path;
  const sourceExt = path.extname(req.file.originalname).slice(1).toLowerCase();
  const targetExt = req.body.targetFormat?.toLowerCase();
  const category = getFileCategory(sourceExt);

  if (!targetExt) {
    fs.unlinkSync(sourcePath);
    return res.status(400).json({ error: 'Target format required' });
  }

  if (!category || category !== getFileCategory(targetExt)) {
    fs.unlinkSync(sourcePath);
    return res.status(400).json({ error: 'Incompatible source and target formats' });
  }

  const targetFilename = `${path.basename(req.file.originalname, path.extname(req.file.originalname))}.${targetExt}`;
  const targetPath = path.join('uploads', targetFilename);

  try {
    const command = getConversionCommand(sourcePath, targetPath, sourceExt, targetExt, category);
    await execAsync(command);

    // For LibreOffice, the output file is in the outdir with the new extension
    const finalTargetPath = category === 'document' ? path.join('uploads', `${path.basename(sourcePath)}.${targetExt}`) : targetPath;

    res.download(finalTargetPath, targetFilename, (err) => {
      // Cleanup regardless of success
      fs.unlinkSync(sourcePath);
      if (fs.existsSync(finalTargetPath)) fs.unlinkSync(finalTargetPath);
      if (err) {
        console.error('Download error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to send converted file' });
      }
    });
  } catch (error) {
    fs.unlinkSync(sourcePath);
    if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
    console.error('Conversion error:', error);
    res.status(500).json({ error: error.message || 'Conversion failed' });
  }
});

// Health check endpoint (optional, but good for Render)
app.get('/', (req, res) => res.send('Backend is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
