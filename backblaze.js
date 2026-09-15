const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
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
let nativeAuthPromise = null;
let nativeBucketIdPromise = null;
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

async function getNativeB2Auth() {
  if (!nativeAuthPromise) {
    nativeAuthPromise = fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
      headers: {
        Authorization: `Basic ${Buffer.from(`${KEY_ID}:${APP_KEY}`).toString('base64')}`
      }
    }).then(async response => {
      if (!response.ok) throw new Error(`B2 authorization failed (${response.status})`);
      return response.json();
    }).catch(error => {
      nativeAuthPromise = null;
      throw error;
    });
  }
  return nativeAuthPromise;
}

async function getNativeB2BucketId(auth) {
  if (!nativeBucketIdPromise) {
    nativeBucketIdPromise = fetch(`${auth.apiUrl}/b2api/v2/b2_list_buckets`, {
      method: 'POST',
      headers: {
        Authorization: auth.authorizationToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ accountId: auth.accountId, bucketName: BUCKET })
    }).then(async response => {
      if (!response.ok) throw new Error(`B2 bucket lookup failed (${response.status})`);
      const data = await response.json();
      const bucket = (data.buckets || []).find(item => item.bucketName === BUCKET);
      if (!bucket?.bucketId) throw new Error(`B2 bucket not found: ${BUCKET}`);
      return bucket.bucketId;
    }).catch(error => {
      nativeBucketIdPromise = null;
      throw error;
    });
  }
  return nativeBucketIdPromise;
}

async function deleteAllNativeB2Versions(key) {
  const auth = await getNativeB2Auth();
  const bucketId = await getNativeB2BucketId(auth);
  let startFileName = key;
  let startFileId;
  let deleted = 0;

  do {
    const response = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_file_versions`, {
      method: 'POST',
      headers: {
        Authorization: auth.authorizationToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        bucketId,
        startFileName,
        startFileId,
        maxFileCount: 1000
      })
    });
    if (!response.ok) throw new Error(`B2 version listing failed (${response.status})`);
    const data = await response.json();
    const matches = (data.files || []).filter(file => file.fileName === key);

    for (const file of matches) {
      const deleteResponse = await fetch(`${auth.apiUrl}/b2api/v2/b2_delete_file_version`, {
        method: 'POST',
        headers: {
          Authorization: auth.authorizationToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fileName: file.fileName, fileId: file.fileId })
      });
      if (!deleteResponse.ok) throw new Error(`B2 version deletion failed (${deleteResponse.status})`);
      deleted += 1;
    }

    if (!data.nextFileName || data.nextFileName !== key) break;
    startFileName = data.nextFileName;
    startFileId = data.nextFileId;
  } while (true);

  return deleted > 0;
}

/** Delete a single object from B2 and return whether delete was attempted. */
async function deleteFromB2(key) {
  try {
    const nativeDeleted = await deleteAllNativeB2Versions(key);
    if (nativeDeleted) return true;

    let keyMarker;
    let versionIdMarker;
    let foundVersion = false;

    do {
      const response = await s3Client.send(new ListObjectVersionsCommand({
        Bucket: BUCKET,
        Prefix: key,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      }));
      const versions = [
        ...(response.Versions || []),
        ...(response.DeleteMarkers || [])
      ].filter(version => version.Key === key && version.VersionId);

      for (const version of versions) {
        foundVersion = true;
        await s3Client.send(new DeleteObjectCommand({
          Bucket: BUCKET,
          Key: key,
          VersionId: version.VersionId,
        }));
      }

      if (!response.IsTruncated) break;
      keyMarker = response.NextKeyMarker;
      versionIdMarker = response.NextVersionIdMarker;
    } while (keyMarker || versionIdMarker);

    if (!foundVersion) {
      const exists = await b2ObjectExists(key);
      if (!exists) return true;
      await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    }
    return true;
  } catch (err) {
    console.error(`B2 delete error bucket="${BUCKET}" key="${key}":`, err.message);
    try {
      const exists = await b2ObjectExists(key);
      if (!exists) return true;
      await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
      return true;
    } catch (fallbackError) {
      console.error(`B2 fallback delete error bucket="${BUCKET}" key="${key}":`, fallbackError.message);
      return false;
    }
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

/** Basic health check to verify B2 API credentials and bucket access. */
async function checkB2Health() {
  if (!b2Enabled || !s3Client) {
    return { ok: false, reason: 'not-configured' };
  }

  try {
    await s3Client.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      MaxKeys: 1
    }));
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.message || 'b2-check-failed' };
  }
}

/** Return the public URL for a B2 object key. */
function getB2Url(key) {
  return `${PUBLIC_URL}/${key}`;
}

module.exports = { b2Enabled, uploadToB2, deleteFromB2, deleteFromB2Prefix, getB2Url, checkB2Health };
