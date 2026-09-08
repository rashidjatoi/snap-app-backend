const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');
const { v4: uuid } = require('uuid');

let bucket;

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  }
  const localPath = path.join(
    __dirname,
    '..',
    '..',
    'snap-app-8c28d-firebase-adminsdk-fbsvc-fe94ddc92d.json',
  );
  if (fs.existsSync(localPath)) {
    return JSON.parse(fs.readFileSync(localPath, 'utf8'));
  }
  throw new Error(
    'Firebase credentials missing. Set FIREBASE_SERVICE_ACCOUNT or place the service account JSON in backend/.',
  );
}

function initFirebase() {
  if (admin.apps.length) {
    bucket = admin.storage().bucket();
    return admin;
  }

  const serviceAccount = loadServiceAccount();
  const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET ||
    `${serviceAccount.project_id}.firebasestorage.app`;

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket,
  });
  bucket = admin.storage().bucket();
  console.log(`Firebase Storage ready: ${storageBucket}`);
  return admin;
}

function getBucket() {
  if (!bucket) initFirebase();
  return bucket;
}

/**
 * Upload a buffer to Firebase Storage and return a long-lived download URL.
 * @param {Buffer} buffer
 * @param {{ folder?: string, filename?: string, contentType?: string, userId?: string }} options
 */
async function uploadBuffer(buffer, options = {}) {
  const storage = getBucket();
  const folder = options.folder || 'uploads';
  const ext = (options.filename && path.extname(options.filename)) || '.jpg';
  const safeName = `${Date.now()}_${uuid().slice(0, 8)}${ext}`;
  const userPart = options.userId ? `${options.userId}/` : '';
  const objectPath = `${folder}/${userPart}${safeName}`;
  const file = storage.file(objectPath);
  const token = uuid();

  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: options.contentType || 'image/jpeg',
      metadata: {
        firebaseStorageDownloadTokens: token,
        uploadedBy: options.userId || 'system',
      },
      cacheControl: 'public, max-age=31536000',
    },
  });

  const encoded = encodeURIComponent(objectPath);
  const url = `https://firebasestorage.googleapis.com/v0/b/${storage.name}/o/${encoded}?alt=media&token=${token}`;

  return {
    url,
    path: objectPath,
    bucket: storage.name,
    contentType: options.contentType || 'image/jpeg',
  };
}

module.exports = { initFirebase, getBucket, uploadBuffer };
