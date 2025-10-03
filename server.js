/**
 * FreeFileConverters Backend Server
 * Handles file upload and conversion using various tools
 */

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Configure multer for file uploads (temp storage)
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(7)}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 1024 * 1024 * 1024 // 1GB limit
  }
});

/**
 * Supported conversion mappings
 */
const CONVERSION_TOOLS = {
  image: {
    tool: 'imagemagick',
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico']
  },
  audio: {
    tool: 'ffmpeg',
    extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac']
  },
  video: {
    tool: 'ffmpeg',
    extensions: ['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv']
  },
  document: {
    tool: 'libreoffice',
    extensions: ['pdf', 'docx', 'doc', 'odt', 'txt', 'rtf', 'pptx', 'xlsx']
  }
};

/**
 * Get file category based on extension
 */
function getFileCategory(extension) {
  for (const [category, config] of Object.entries(CONVERSION_TOOLS)) {
    if (config.extensions.includes(extension.toLowerCase())) {
      return category;
    }
  }
  return null;
}

/**
 * Convert image files using ImageMagick
 */
async function convertImage(inputPath, outputPath, targetFormat) {
  try {
    const command = `convert "${inputPath}" "${outputPath}"`;
    await execPromise(command);
    return outputPath;
  } catch (error) {
    throw new Error(`Image conversion failed: ${error.message}`);
  }
}

/**
 * Convert audio/video files using FFmpeg
 */
async function convertMedia(inputPath, outputPath, targetFormat, isVideo = false) {
  try {
    let command;
    
    if (isVideo) {
      // Video conversion with common codec settings
      command = `ffmpeg -i "${inputPath}" -c:v libx264 -preset medium -crf 23 -c:a aac -b:a 128k "${outputPath}" -y`;
      
      // Adjust for specific formats
      if (targetFormat === 'webm') {
        command = `ffmpeg -i "${inputPath}" -c:v libvpx-vp9 -c:a libopus "${outputPath}" -y`;
      } else if (targetFormat === 'avi') {
        command = `ffmpeg -i "${inputPath}" -c:v mpeg4 -c:a libmp3lame "${outputPath}" -y`;
      }
    } else {
      // Audio conversion
      command = `ffmpeg -i "${inputPath}" -vn "${outputPath}" -y`;
      
      // Adjust bitrate for specific formats
      if (targetFormat === 'mp3') {
        command = `ffmpeg -i "${inputPath}" -vn -b:a 192k "${outputPath}" -y`;
      } else if (targetFormat === 'flac') {
        command = `ffmpeg -i "${inputPath}" -vn -c:a flac "${outputPath}" -y`;
      }
    }
    
    await execPromise(command);
    return outputPath;
  } catch (error) {
    throw new Error(`Media conversion failed: ${error.message}`);
  }
}

/**
 * Convert document files using LibreOffice
 */
async function convertDocument(inputPath, outputPath, targetFormat) {
  try {
    const outputDir = path.dirname(outputPath);
    const inputExt = path.extname(inputPath).substring(1).toLowerCase();
    
    // For text-to-text conversions, just copy
    if ((inputExt === 'txt' && targetFormat === 'txt') || 
        (inputExt === targetFormat)) {
      await fs.copyFile(inputPath, outputPath);
      return outputPath;
    }
    
    // LibreOffice conversion
    if (targetFormat === 'pdf') {
      const command = `libreoffice --headless --convert-to pdf --outdir "${outputDir}" "${inputPath}"`;
      await execPromise(command, { timeout: 60000 });
      
      // LibreOffice generates filename based on input name
      const baseName = path.basename(inputPath, path.extname(inputPath));
      const generatedFile = path.join(outputDir, `${baseName}.pdf`);
      
      // Rename to expected output
      if (generatedFile !== outputPath) {
        await fs.rename(generatedFile, outputPath);
      }
    } else if (targetFormat === 'docx') {
      const command = `libreoffice --headless --convert-to docx --outdir "${outputDir}" "${inputPath}"`;
      await execPromise(command, { timeout: 60000 });
      
      const baseName = path.basename(inputPath, path.extname(inputPath));
      const generatedFile = path.join(outputDir, `${baseName}.docx`);
      
      if (generatedFile !== outputPath) {
        await fs.rename(generatedFile, outputPath);
      }
    } else if (targetFormat === 'txt') {
      const command = `libreoffice --headless --convert-to txt --outdir "${outputDir}" "${inputPath}"`;
      await execPromise(command, { timeout: 60000 });
      
      const baseName = path.basename(inputPath, path.extname(inputPath));
      const generatedFile = path.join(outputDir, `${baseName}.txt`);
      
      if (generatedFile !== outputPath) {
        await fs.rename(generatedFile, outputPath);
      }
    } else {
      throw new Error(`Unsupported document conversion to ${targetFormat}`);
    }
    
    return outputPath;
  } catch (error) {
    throw new Error(`Document conversion failed: ${error.message}`);
  }
}

/**
 * Main conversion function
 */
async function convertFile(inputPath, targetFormat) {
  const inputExt = path.extname(inputPath).substring(1).toLowerCase();
  const outputPath = inputPath.replace(path.extname(inputPath), `.${targetFormat}`);
  
  const sourceCategory = getFileCategory(inputExt);
  const targetCategory = getFileCategory(targetFormat);
  
  if (!sourceCategory || !targetCategory) {
    throw new Error('Unsupported file format');
  }
  
  // Check if conversion between categories is possible
  if (sourceCategory !== targetCategory && 
      !(sourceCategory === 'document' && targetCategory === 'document')) {
    throw new Error(`Cannot convert ${sourceCategory} to ${targetCategory}`);
  }
  
  // Perform conversion based on file type
  switch (sourceCategory) {
    case 'image':
      return await convertImage(inputPath, outputPath, targetFormat);
    case 'audio':
      return await convertMedia(inputPath, outputPath, targetFormat, false);
    case 'video':
      return await convertMedia(inputPath, outputPath, targetFormat, true);
    case 'document':
      return await convertDocument(inputPath, outputPath, targetFormat);
    default:
      throw new Error('Unsupported file type');
  }
}

/**
 * Clean up temporary files
 */
async function cleanupFiles(...filePaths) {
  for (const filePath of filePaths) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      console.error(`Failed to delete ${filePath}:`, error.message);
    }
  }
}

/**
 * POST /convert - Main conversion endpoint
 */
app.post('/convert', upload.single('file'), async (req, res) => {
  let inputPath = null;
  let outputPath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const targetFormat = req.body.targetFormat;
    
    if (!targetFormat) {
      await cleanupFiles(req.file.path);
      return res.status(400).json({ error: 'Target format not specified' });
    }
    
    inputPath = req.file.path;
    
    console.log(`Converting ${req.file.originalname} to ${targetFormat}`);
    
    // Perform conversion
    outputPath = await convertFile(inputPath, targetFormat);
    
    // Check if output file exists
    const stats = await fs.stat(outputPath);
    if (!stats.isFile()) {
      throw new Error('Conversion produced no output file');
    }
    
    // Send the converted file
    res.download(outputPath, `converted.${targetFormat}`, async (err) => {
      // Cleanup both input and output files after download
      await cleanupFiles(inputPath, outputPath);
      
      if (err) {
        console.error('Download error:', err);
      }
    });
    
  } catch (error) {
    console.error('Conversion error:', error);
    
    // Cleanup on error
    if (inputPath) await cleanupFiles(inputPath);
    if (outputPath) await cleanupFiles(outputPath);
    
    res.status(500).json({ 
      error: error.message || 'Conversion failed',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * GET / - Health check
 */
app.get('/', (req, res) => {
  res.json({ 
    status: 'online',
    service: 'FreeFileConverters API',
    version: '1.0.0'
  });
});

/**
 * GET /health - Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

/**
 * Start server
 */
app.listen(PORT, () => {
  console.log(`✓ FreeFileConverters backend running on port ${PORT}`);
  console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
});
