/**
 * Convert document files using LibreOffice
 */
async function convertDocument(inputPath, outputPath, targetFormat) {
  try {
    const outputDir = path.dirname(outputPath);
    const inputExt = path.extname(inputPath).substring(1).toLowerCase();
    
    // For identical format conversions, just copy
    if (inputExt === targetFormat) {
      await fs.copyFile(inputPath, outputPath);
      return outputPath;
    }
    
    // LibreOffice conversion mapping
    const libreOfficeFormats = {
      'pdf': 'pdf',
      'docx': 'docx',
      'doc': 'doc',
      'odt': 'odt',
      'txt': 'txt:Text',
      'rtf': 'rtf',
      'pptx': 'pptx',
      'xlsx': 'xlsx'
    };
    
    if (!libreOfficeFormats[targetFormat]) {
      throw new Error(`Unsupported document conversion to ${targetFormat}`);
    }
    
    // Execute LibreOffice conversion
    const convertFormat = libreOfficeFormats[targetFormat];
    const command = `libreoffice --headless --convert-to ${convertFormat} --outdir "${outputDir}" "${inputPath}"`;
    await execPromise(command, { timeout: 60000 });
    
    // LibreOffice generates filename based on input name
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const generatedFile = path.join(outputDir, `${baseName}.${targetFormat}`);
    
    // Rename to expected output if needed
    if (generatedFile !== outputPath) {
      await fs.rename(generatedFile, outputPath);
    }
    
    return outputPath;
  } catch (error) {
    throw new Error(`Document conversion failed: ${error.message}`);
  }
}
