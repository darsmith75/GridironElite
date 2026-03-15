const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');

const BUCKET  = process.env.B2_BUCKET_NAME   || '';
const REGION  = process.env.B2_BUCKET_REGION  || '';
const KEY_ID  = process.env.B2_KEY_ID         || '';
const APP_KEY = process.env.B2_APP_KEY        || '';

const b2Enabled = !!(BUCKET && REGION && KEY_ID && APP_KEY);

// Public CDN / download URL for objects.
// If you use a Cloudflare CDN in front of your bucket, set B2_PUBLIC_URL to that domain.
// Otherwise defaults to the native Backblaze S3-compatible endpoint.
const PUBLIC_URL = (
  process.env.B2_PUBLIC_URL ||
  (b2Enabled ? `https://${BUCKET}.s3.${REGION}.backblazeb2.com` : '')
).replace(/\/$/, '');

let s3Client = null;
if (b2Enabled) {
  s3Client = new S3Client({
    endpoint: `https://s3.${REGION}.backblazeb2.com`,
    region: REGION,
    credentials: { accessKeyId: KEY_ID, secretAccessKey: APP_KEY },
  });
  console.log(`Backblaze B2 enabled  bucket="${BUCKET}"  region="${REGION}"`);
} else {
  console.log('Backblaze B2 not configured – using local disk storage for uploads');
}

/** Upload a Buffer to B2. key = e.g. "uploads/5/abc.jpg" */
async function uploadToB2(key, buffer, contentType) {
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
}

/** Check if an object key exists in B2. */
async function b2ObjectExists(key) {
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err) {
    // NotFound / 404 means key does not exist.
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === 'NotFound' || err?.Code === 'NotFound') {
      return false;
    }
    throw err;
  }
}

/** Delete a single object from B2 and return whether delete was attempted. */
async function deleteFromB2(key) {
  try {
    const exists = await b2ObjectExists(key);
    if (!exists) return false;
    await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err) {
    console.error(`B2 delete error key="${key}":`, err.message);
    return false;
  }
}

/** Delete every object whose key starts with prefix (e.g. "uploads/5/"). */
async function deleteFromB2Prefix(prefix) {
  try {
    let token;
    do {
      const resp = await s3Client.send(new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      }));
      for (const obj of (resp.Contents || [])) {
        await deleteFromB2(obj.Key);
      }
      token = resp.IsTruncated ? resp.NextContinuationToken : null;
    } while (token);
  } catch (err) {
    console.error(`B2 prefix-delete error prefix="${prefix}":`, err.message);
  }
}

/** Return the public URL for a B2 object key. */
function getB2Url(key) {
  return `${PUBLIC_URL}/${key}`;
}

module.exports = { b2Enabled, uploadToB2, deleteFromB2, deleteFromB2Prefix, getB2Url };
