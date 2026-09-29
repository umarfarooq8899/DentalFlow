'use strict';

/**
 * S3-compatible private object storage client.
 *
 * Supports AWS S3, MinIO, and Cloudflare R2.
 * All buckets MUST be private. Clients receive short-lived pre-signed URLs.
 *
 * Required environment variables:
 *   S3_ENDPOINT        – e.g. "https://s3.amazonaws.com" or MinIO URL
 *   S3_REGION          – e.g. "us-east-1"
 *   S3_ACCESS_KEY_ID   – Access key ID
 *   S3_SECRET_ACCESS_KEY – Secret access key
 *   S3_BUCKET_NAME     – Target bucket name
 *   S3_SIGNED_URL_EXPIRES_SECONDS – URL expiry in seconds (default: 900)
 */

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const env = require('../config/env');

let _client = null;

function getClient() {
  if (_client) return _client;

  const config = {
    region: env.S3_REGION || 'us-east-1',
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY || '',
    },
  };

  // Custom endpoint for MinIO or R2
  if (env.S3_ENDPOINT) {
    config.endpoint = env.S3_ENDPOINT;
    config.forcePathStyle = true;
  }

  _client = new S3Client(config);
  return _client;
}

const BUCKET = () => env.S3_BUCKET_NAME || 'dentalflow-documents';
const SIGNED_URL_EXPIRES = () =>
  parseInt(env.S3_SIGNED_URL_EXPIRES_SECONDS || '900', 10);

/**
 * Generate a pre-signed upload URL (PUT) for a given S3 key.
 * Used for direct browser-to-S3 multipart uploads.
 * @param {string} key       – S3 object key
 * @param {string} mimeType  – Content-Type
 * @param {number} expiresIn – Seconds until URL expires (default: env config)
 */
async function generateUploadUrl(key, mimeType, expiresIn = SIGNED_URL_EXPIRES()) {
  const command = new PutObjectCommand({
    Bucket: BUCKET(),
    Key: key,
    ContentType: mimeType,
  });
  return getSignedUrl(getClient(), command, { expiresIn });
}

/**
 * Generate a short-lived pre-signed download URL (GET) for a given S3 key.
 * NEVER return this URL in any public endpoint.
 * @param {string} key       – S3 object key
 * @param {number} expiresIn – Seconds until URL expires (default: env config)
 */
async function generateDownloadUrl(key, expiresIn = SIGNED_URL_EXPIRES()) {
  const command = new GetObjectCommand({
    Bucket: BUCKET(),
    Key: key,
  });
  return getSignedUrl(getClient(), command, { expiresIn });
}

/**
 * Delete an object from S3.
 * @param {string} key – S3 object key
 */
async function deleteObject(key) {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET(),
    Key: key,
  });
  await getClient().send(command);
}

/**
 * Check if an object exists in S3.
 * @param {string} key – S3 object key
 * @returns {boolean}
 */
async function objectExists(key) {
  try {
    const command = new HeadObjectCommand({ Bucket: BUCKET(), Key: key });
    await getClient().send(command);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a canonical S3 object key for a patient document.
 * Format: clinicId/patients/patientId/type/uuid-filename
 * @param {string} clinicId
 * @param {string} patientId
 * @param {string} type
 * @param {string} uniqueName – filename with uuid prefix
 */
function buildObjectKey(clinicId, patientId, type, uniqueName) {
  return `${clinicId}/patients/${patientId}/${type}/${uniqueName}`;
}

module.exports = {
  generateUploadUrl,
  generateDownloadUrl,
  deleteObject,
  objectExists,
  buildObjectKey,
};
