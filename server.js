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
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Get category from extension (matching frontend FORMATS)
const getFileCategory = (ext) => {
  const lowerExt = ext.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'].includes(lowerExt)) return 'image';
  if (['pdf', 'docx', 'doc', 'odt', 'txt', 'rtf', 'ppt', 'pptx', 'odp'].includes(lowerExt)) return 'document';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(lowerExt)) return 'audio';
  if (['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv'].includes(lowerExt)) return 'video';
  return null;
};

// Perform conversion (async, handles chaining for cross-category)
async function performConversion(sourcePath, targetPath, sourceExt, targetExt, category) {
  let finalPaths = [targetPath];
  const sourceCat = category;
  const targetCat = getFileCategory(targetExt);

  try {
    if (sourceCat === targetCat) {
      // Same category
      let command;
      if (sourceCat === 'image') {
        command = `convert "${sourcePath}" "${targetPath}"`;
      } else if (sourceCat === 'document') {
        command = `libreoffice --headless --convert-to ${targetExt} --outdir "${path.dirname(targetPath)}" "${sourcePath}"`;
        await execAsync(command);
        finalPaths = [path.join(path.dirname(targetPath), `${path.basename(sourcePath, path.extname(sourcePath))}.${targetExt}`)];
        return finalPaths;
      } else {
        command = `ffmpeg -i "${sourcePath}" "${targetPath}"`;
      }
      await execAsync(command);
    } else if (sourceCat === 'image' && targetCat === 'document') {
      // Image to document (via PDF if needed)
      if (targetExt === 'pdf') {
        await execAsync(`convert "${sourcePath}" "${targetPath}"`);
      } else {
        const tempPdf = path.join('uploads', `temp_${Date.now()}.pdf`);
        await execAsync(`convert "${sourcePath}" "${tempPdf}"`);
        await execAsync(`libreoffice --headless --convert-to ${targetExt} --outdir "${path.dirname(targetPath)}" "${tempPdf}"`);
        fs.unlinkSync(tempPdf);
        finalPaths = [path.join(path.dirname(targetPath), `${path.basename(tempPdf, '.pdf')}.${targetExt}`)];
        return finalPaths;
      }
    } else if (sourceCat === 'document' && targetCat === 'image') {
      // Document to image (via PDF)
      let pdfPath = sourcePath;
      let tempPdfCreated = false;
      if (sourceExt !== 'pdf') {
        const tempPdfName = `temp_${Date.now()}.pdf`;
        pdfPath = path.join('uploads', tempPdfName);
        await execAsync(`libreoffice --headless --convert-to pdf --outdir "${path.dirname(pdfPath)}" "${sourcePath}"`);
        pdfPath = path.join(path.dirname(pdfPath), `${path.basename(sourcePath, path.extname(sourcePath))}.pdf`);
        tempPdfCreated = true;
      }
      await execAsync(`convert "${pdfPath}" "${targetPath}"`);
      if (tempPdfCreated) fs.unlinkSync(pdfPath);
    } else {
      throw new Error('Incompatible source and target formats');
    }

    // Collect output files (handle multi-page outputs)
    const dir = path.dirname(targetPath);
    const base = path.basename(targetPath, `.${targetExt}`);
    const multiFiles = fs.readdirSync(dir)
      .filter(f => f.match(new RegExp(`^${base}-\\d+\\.${targetExt}$`)))
      .map(f => path.join(dir, f))
      .sort((a, b) => {
        const numA = parseInt(a.match(/-(\d+)\./)[1]);
        const numB = parseInt(b.match(/-(\d+)\./)[1]);
        return numA - numB;
      });

    if (multiFiles.length > 0) {
      finalPaths = multiFiles;
    } else if (fs.existsSync(targetPath)) {
      finalPaths = [targetPath];
    } else {
      throw new Error('No output files generated');
    }

    return finalPaths;
  } catch (error) {
    throw error;
  }
}

// Conversion endpoint
app.post('/convert', upload.array('files', 4), async (req, res) => {
  const files = req.files;
  const targetExt = req.body.targetFormat?.toLowerCase();

  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  if (!targetExt) {
    files.forEach(file => fs.unlinkSync(file.path));
    return res.status(400).json({ error: 'Target format required' });
  }

  let allOutputFiles = [];
  const tempFiles = [];

  try {
    for (const file of files) {
      const sourcePath = file.path;
      const sourceExt = path.extname(file.originalname).slice(1).toLowerCase();
      const category = getFileCategory(sourceExt);

      if (!category) {
        throw new Error(`Unsupported source format: ${sourceExt}`);
      }

      if (getFileCategory(targetExt) === null) {
        throw new Error(`Unsupported target format: ${targetExt}`);
      }

      const targetFilename = `${path.basename(file.originalname, path.extname(file.originalname))}.${targetExt}`;
      const targetPath = path.join('uploads', `${Date.now()}_${targetFilename}`);

      const outputFiles = await performConversion(sourcePath, targetPath, sourceExt, targetExt, category);
      allOutputFiles = allOutputFiles.concat(outputFiles);
      tempFiles.push(sourcePath);
    }

    // If only one output file, send it directly
    if (allOutputFiles.length === 1) {
      const singleFile = allOutputFiles[0];
      const downloadName = path.basename(singleFile);
      res.download(singleFile, downloadName, (err) => {
        if (err) {
          console.error('Download error:', err);
          if (!res.headersSent) res.status(500).json({ error: 'Failed to send converted file' });
        }
        // Cleanup
        [...allOutputFiles, ...tempFiles].forEach(f => {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        });
      });
    } else {
      // Multiple files: zip them
      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', 'attachment; filename="converted_files.zip"');

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.pipe(res);

      allOutputFiles.forEach(file => {
        archive.file(file, { name: path.basename(file) });
      });

      archive.on('error', (err) => {
        throw err;
      });

      archive.finalize();

      archive.on('finish', () => {
        // Cleanup
        [...allOutputFiles, ...tempFiles].forEach(f => {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        });
      });
    }
  } catch (error) {
    [...allOutputFiles, ...tempFiles].forEach(f => {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    });
    console.error('Conversion error:', error);
    res.status(500).json({ error: error.message || 'Conversion failed' });
  }
});

// Health check endpoint
app.get('/', (req, res) => res.send('Backend is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
