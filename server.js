const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const archiver = require('archiver');

const execAsync = promisify(exec);
const app = express();

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 1024 * 1024 * 1024 } // 1GB
});

app.use(cors());
app.use(express.json());

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Get category from extension
const getFileCategory = (ext) => {
  const lowerExt = ext.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'tiff', 'tif'].includes(lowerExt)) {
    return 'image';
  }
  if (['pdf', 'docx', 'doc', 'odt', 'txt', 'rtf', 'ppt', 'pptx', 'odp'].includes(lowerExt)) {
    return 'document';
  }
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(lowerExt)) {
    return 'audio';
  }
  if (['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv'].includes(lowerExt)) {
    return 'video';
  }
  return null;
};

// Perform conversion with comprehensive format support
async function performConversion(sourcePath, targetPath, sourceExt, targetExt) {
  const sourceCat = getFileCategory(sourceExt);
  const targetCat = getFileCategory(targetExt);

  if (!sourceCat || !targetCat) {
    throw new Error(`Unsupported format: ${sourceExt} to ${targetExt}`);
  }

  try {
    let command;
    let outputFiles = [];

    // SAME CATEGORY CONVERSIONS
    if (sourceCat === targetCat) {
      if (sourceCat === 'image') {
        // Image to Image
        command = `magick "${sourcePath}" "${targetPath}"`;
        await execAsync(command, { timeout: 60000 });
        outputFiles = [targetPath];
      } 
      else if (sourceCat === 'document') {
        // Document to Document (including presentations)
        const outputDir = path.dirname(targetPath);
        const baseName = path.basename(sourcePath, path.extname(sourcePath));
        
        command = `libreoffice --headless --convert-to ${targetExt} --outdir "${outputDir}" "${sourcePath}"`;
        await execAsync(command, { timeout: 120000 });
        
        // LibreOffice uses source filename, not target filename
        const expectedOutput = path.join(outputDir, `${baseName}.${targetExt}`);
        if (fs.existsSync(expectedOutput)) {
          fs.renameSync(expectedOutput, targetPath);
          outputFiles = [targetPath];
        } else {
          throw new Error('LibreOffice conversion failed');
        }
      }
      else if (sourceCat === 'audio' || sourceCat === 'video') {
        // Audio/Video conversion
        command = `ffmpeg -i "${sourcePath}" -y "${targetPath}"`;
        await execAsync(command, { timeout: 300000 });
        outputFiles = [targetPath];
      }
    }
    // CROSS-CATEGORY CONVERSIONS
    else if (sourceCat === 'image' && targetCat === 'document') {
      // Image to Document
      if (targetExt === 'pdf') {
        // Direct image to PDF
        command = `magick "${sourcePath}" "${targetPath}"`;
        await execAsync(command, { timeout: 60000 });
        outputFiles = [targetPath];
      } else {
        // Image -> PDF -> Document
        const tempPdf = path.join('uploads', `temp_${Date.now()}.pdf`);
        await execAsync(`magick "${sourcePath}" "${tempPdf}"`, { timeout: 60000 });
        
        const outputDir = path.dirname(targetPath);
        const baseName = path.basename(tempPdf, '.pdf');
        command = `libreoffice --headless --convert-to ${targetExt} --outdir "${outputDir}" "${tempPdf}"`;
        await execAsync(command, { timeout: 120000 });
        
        const expectedOutput = path.join(outputDir, `${baseName}.${targetExt}`);
        if (fs.existsSync(expectedOutput)) {
          fs.renameSync(expectedOutput, targetPath);
          outputFiles = [targetPath];
        }
        
        if (fs.existsSync(tempPdf)) fs.unlinkSync(tempPdf);
      }
    }
    else if (sourceCat === 'document' && targetCat === 'image') {
      // Document to Image
      let pdfPath = sourcePath;
      let tempPdfCreated = false;

      // Convert to PDF first if not already PDF
      if (sourceExt.toLowerCase() !== 'pdf') {
        const outputDir = path.dirname(sourcePath);
        const baseName = path.basename(sourcePath, path.extname(sourcePath));
        
        command = `libreoffice --headless --convert-to pdf --outdir "${outputDir}" "${sourcePath}"`;
        await execAsync(command, { timeout: 120000 });
        
        pdfPath = path.join(outputDir, `${baseName}.pdf`);
        tempPdfCreated = true;
        
        if (!fs.existsSync(pdfPath)) {
          throw new Error('PDF conversion failed');
        }
      }

      // Convert PDF to image(s)
      const targetDir = path.dirname(targetPath);
      const targetBase = path.basename(targetPath, `.${targetExt}`);
      
      command = `magick -density 300 "${pdfPath}" "${targetPath}"`;
      await execAsync(command, { timeout: 120000 });

      // Check for multi-page output
      const multiPagePattern = new RegExp(`^${targetBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+\\.${targetExt}$`);
      const files = fs.readdirSync(targetDir)
        .filter(f => multiPagePattern.test(f))
        .map(f => path.join(targetDir, f))
        .sort();

      if (files.length > 0) {
        outputFiles = files;
      } else if (fs.existsSync(targetPath)) {
        outputFiles = [targetPath];
      } else {
        throw new Error('No output images generated');
      }

      if (tempPdfCreated && fs.existsSync(pdfPath)) {
        fs.unlinkSync(pdfPath);
      }
    }
    else {
      throw new Error(`Conversion from ${sourceCat} to ${targetCat} is not supported`);
    }

    // Verify output files exist
    if (outputFiles.length === 0) {
      throw new Error('No output files were generated');
    }

    for (const file of outputFiles) {
      if (!fs.existsSync(file)) {
        throw new Error(`Expected output file not found: ${file}`);
      }
    }

    return outputFiles;

  } catch (error) {
    console.error('Conversion error:', error);
    throw new Error(error.message || 'Conversion failed');
  }
}

// Conversion endpoint
app.post('/convert', upload.array('files', 4), async (req, res) => {
  const files = req.files;
  const targetExt = req.body.targetFormat?.toLowerCase();

  console.log('Conversion request received:', {
    fileCount: files?.length,
    targetFormat: targetExt
  });

  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  if (!targetExt) {
    files.forEach(file => fs.unlinkSync(file.path));
    return res.status(400).json({ error: 'Target format is required' });
  }

  let allOutputFiles = [];
  const tempFiles = [];

  try {
    // Process each uploaded file
    for (const file of files) {
      const sourcePath = file.path;
      const sourceExt = path.extname(file.originalname).slice(1).toLowerCase();
      
      console.log(`Processing: ${file.originalname} (${sourceExt} -> ${targetExt})`);

      const targetFilename = `${path.basename(file.originalname, path.extname(file.originalname))}.${targetExt}`;
      const targetPath = path.join('uploads', `${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${targetFilename}`);

      const outputFiles = await performConversion(sourcePath, targetPath, sourceExt, targetExt);
      allOutputFiles = allOutputFiles.concat(outputFiles);
      tempFiles.push(sourcePath);
    }

    console.log(`Conversion complete. Output files: ${allOutputFiles.length}`);

    // Send response
    if (allOutputFiles.length === 1) {
      // Single file - send directly
      const singleFile = allOutputFiles[0];
      const downloadName = path.basename(singleFile);
      
      res.download(singleFile, downloadName, (err) => {
        // Cleanup after download
        [...allOutputFiles, ...tempFiles].forEach(f => {
          try {
            if (fs.existsSync(f)) fs.unlinkSync(f);
          } catch (e) {
            console.error('Cleanup error:', e);
          }
        });
      });
    } else {
      // Multiple files - send as ZIP
      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', 'attachment; filename="converted_files.zip"');

      const archive = archiver('zip', { zlib: { level: 9 } });
      
      archive.on('error', (err) => {
        console.error('Archive error:', err);
        throw err;
      });

      archive.pipe(res);

      // Add each file to the archive
      allOutputFiles.forEach(file => {
        archive.file(file, { name: path.basename(file) });
      });

      await archive.finalize();

      // Cleanup after archive is sent
      archive.on('finish', () => {
        [...allOutputFiles, ...tempFiles].forEach(f => {
          try {
            if (fs.existsSync(f)) fs.unlinkSync(f);
          } catch (e) {
            console.error('Cleanup error:', e);
          }
        });
      });
    }

  } catch (error) {
    // Cleanup on error
    [...allOutputFiles, ...tempFiles].forEach(f => {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch (e) {
        console.error('Cleanup error:', e);
      }
    });

    console.error('Conversion error:', error);
    res.status(500).json({ 
      error: error.message || 'Conversion failed',
      details: error.stack
    });
  }
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'running',
    message: 'FreeFileConverter Backend API',
    endpoints: {
      convert: 'POST /convert'
    }
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});
// Add this before the PORT line
app.get('/test-tools', async (req, res) => {
  try {
    const magick = await execAsync('which magick');
    const libreoffice = await execAsync('which libreoffice');
    const ffmpeg = await execAsync('which ffmpeg');
    res.json({
      magick: magick.stdout,
      libreoffice: libreoffice.stdout,
      ffmpeg: ffmpeg.stdout
    });
  } catch (error) {
    res.json({ error: error.message });
  }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Supported conversions:');
  console.log('- Image ↔ Image (PNG, JPG, JPEG, GIF, WEBP, BMP, SVG, ICO, TIFF)');
  console.log('- Document ↔ Document (PDF, DOCX, DOC, ODT, TXT, RTF, PPTX, PPT, ODP)');
  console.log('- Image ↔ Document (cross-category)');
  console.log('- Audio ↔ Audio (MP3, WAV, OGG, M4A, FLAC, AAC)');
  console.log('- Video ↔ Video (MP4, AVI, MOV, MKV, WEBM, FLV)');
});
