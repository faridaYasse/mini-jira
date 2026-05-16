const path = require('path');
const {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const s3 = require('../config/s3');

const ORIGINALS_BUCKET = process.env.S3_ORIGINALS_BUCKET;
const RESIZED_BUCKET   = process.env.S3_RESIZED_BUCKET;

function s3Error(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// Returns every key under a prefix. Follows pagination automatically.
async function listAllKeys(bucket, prefix) {
  const keys = [];
  let continuationToken;

  do {
    const params = { Bucket: bucket, Prefix: prefix };
    if (continuationToken) params.ContinuationToken = continuationToken;

    const { Contents, NextContinuationToken } = await s3.send(
      new ListObjectsV2Command(params)
    );

    if (Contents) {
      for (const obj of Contents) keys.push(obj.Key);
    }

    continuationToken = NextContinuationToken;
  } while (continuationToken);

  return keys;
}

// Deletes a batch of keys from a single bucket.
// DeleteObjectsCommand accepts at most 1000 keys per call.
async function deleteBatch(bucket, keys) {
  if (keys.length === 0) return 0;

  let deleted = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const slice = keys.slice(i, i + 1000).map((Key) => ({ Key }));
    const { Deleted } = await s3.send(
      new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: slice, Quiet: false } })
    );
    deleted += Deleted?.length ?? 0;
  }
  return deleted;
}

// ── Public API ─────────────────────────────────────────────────────────────────

async function uploadImage(taskId, fileBuffer, mimetype, originalName) {
  const ext = path.extname(originalName).toLowerCase() || '.bin';
  const key = `tasks/${taskId}/original-${Date.now()}${ext}`;

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket:      ORIGINALS_BUCKET,
        Key:         key,
        Body:        fileBuffer,
        ContentType: mimetype,
      })
    );
    return key;
  } catch (err) {
    throw s3Error('S3_UPLOAD_FAILED', err.message);
  }
}

async function deleteTaskImages(taskId) {
  const prefix = `tasks/${taskId}/`;

  try {
    const [originalKeys, resizedKeys] = await Promise.all([
      listAllKeys(ORIGINALS_BUCKET, prefix),
      listAllKeys(RESIZED_BUCKET,   prefix),
    ]);

    if (originalKeys.length === 0 && resizedKeys.length === 0) return 0;

    const [deletedOriginals, deletedResized] = await Promise.all([
      deleteBatch(ORIGINALS_BUCKET, originalKeys),
      deleteBatch(RESIZED_BUCKET,   resizedKeys),
    ]);

    return deletedOriginals + deletedResized;
  } catch (err) {
    throw s3Error('S3_DELETE_TASK_IMAGES_FAILED', err.message);
  }
}

async function getImageUrl(bucket, key) {
  try {
    return await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: 3600 }
    );
  } catch (err) {
    throw s3Error('S3_PRESIGN_FAILED', err.message);
  }
}

async function deleteImage(bucket, key) {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    throw s3Error('S3_DELETE_FAILED', err.message);
  }
}

module.exports = {
  uploadImage,
  deleteTaskImages,
  getImageUrl,
  deleteImage,
};
