/**
 * migrate-to-b2.js
 *
 * One-time script to upload all existing local user uploads to Backblaze B2.
 * Run ONCE after configuring your .env file, then new uploads will go directly
 * to B2 via the server.
 *
 * Usage:
 *   node migrate-to-b2.js
 *
 * The script walks the uploads/ directory and mirrors every file to B2 under
 * the same relative key, e.g.  uploads/5/abc.jpg
 * Local files are NOT deleted – they act as a backup until you verify B2 is working.
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');

const { b2Enabled, uploadToB2 } = require('./backblaze');

/** Simple extension → MIME lookup for image and video types. */
const MIME_MAP = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif',  '.webp': 'image/webp',
  '.mp4': 'video/mp4',  '.webm': 'video/webm', '.mov': 'video/quicktime',
};
function getMimeType(filePath) {
  return MIME_MAP[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

if (!b2Enabled) {
  console.error('ERROR: Backblaze B2 is not configured.');
  console.error('Create a .env file from .env.example and fill in your B2 credentials, then re-run.');
  process.exit(1);
}

const UPLOADS_DIR = path.join(__dirname, 'uploads');

/** Recursively collect all files under a directory. */
function walkDir(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, fileList);
    } else {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

async function main() {
  const files = walkDir(UPLOADS_DIR);

  if (files.length === 0) {
    console.log('No files found in uploads/ – nothing to migrate.');
    return;
  }

  console.log(`Found ${files.length} file(s) to migrate.\n`);

  let ok = 0;
  let failed = 0;

  for (const filePath of files) {
    // Convert absolute path to a relative key like "uploads/5/abc.jpg"
    const relPath = path.relative(__dirname, filePath);
    const key     = relPath.replace(/\\/g, '/'); // ensure forward slashes

    const contentType = getMimeType(filePath);
    const buffer = fs.readFileSync(filePath);

    try {
      await uploadToB2(key, buffer, contentType);
      console.log(`  ✓  ${key}`);
      ok++;
    } catch (err) {
      console.error(`  ✗  ${key}  –  ${err.message}`);
      failed++;
    }
  }

  console.log(`\nMigration complete: ${ok} uploaded, ${failed} failed.`);
  if (failed > 0) {
    console.log('Re-run the script to retry failed uploads.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
