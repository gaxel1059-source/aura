/**
 * One-time migration: set public-read ACL on all stored video/thumbnail GCS objects.
 * Run: node --experimental-vm-modules artifacts/api-server/scripts/migrate-video-acls.mjs
 * Env vars must already be set in the shell (DATABASE_URL, PRIVATE_OBJECT_DIR).
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const wsRoot = resolve(__dirname, '../../..');

// Resolve packages from the api-server node_modules
const requireApiServer = createRequire(resolve(__dirname, '../node_modules/.package-lock.json'));
const requireWsRoot = createRequire(resolve(wsRoot, 'node_modules/.package-lock.json'));

// Use @google-cloud/storage from the api-server (it's bundled there)
import gcsModule from '/home/runner/workspace/node_modules/@google-cloud/storage/build/src/index.js';
const { Storage } = gcsModule;

// Use postgres from node_modules
import postgres from '/home/runner/workspace/node_modules/postgres/src/index.js';

const DATABASE_URL = process.env.DATABASE_URL;
const PRIVATE_OBJECT_DIR = process.env.PRIVATE_OBJECT_DIR;

if (!DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
if (!PRIVATE_OBJECT_DIR) { console.error('PRIVATE_OBJECT_DIR not set'); process.exit(1); }

const ACL_POLICY_METADATA_KEY = 'custom:aclPolicy';
const REPLIT_SIDECAR_ENDPOINT = 'http://127.0.0.1:1106';

const storage = new Storage({
  credentials: {
    audience: 'replit',
    subject_token_type: 'access_token',
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: 'external_account',
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: 'json', subject_token_field_name: 'access_token' },
    },
    universe_domain: 'googleapis.com',
  },
  projectId: '',
});

function normalizeObjectEntityPath(rawPath) {
  if (!rawPath.startsWith('https://storage.googleapis.com/')) return rawPath;
  const url = new URL(rawPath);
  let dir = PRIVATE_OBJECT_DIR;
  if (!dir.endsWith('/')) dir += '/';
  if (!url.pathname.startsWith(dir)) return url.pathname;
  return `/objects/${url.pathname.slice(dir.length)}`;
}

async function setPublicAcl(objectPath) {
  const normalized = normalizeObjectEntityPath(objectPath);
  if (!normalized.startsWith('/objects/')) throw new Error(`Bad path: ${normalized}`);
  const entityId = normalized.slice('/objects/'.length);
  let dir = PRIVATE_OBJECT_DIR;
  if (!dir.endsWith('/')) dir += '/';
  const fullPath = `${dir}${entityId}`;

  let bucketName, objectName;
  if (fullPath.startsWith('gs://')) {
    const withoutScheme = fullPath.slice('gs://'.length);
    const idx = withoutScheme.indexOf('/');
    bucketName = withoutScheme.slice(0, idx);
    objectName = withoutScheme.slice(idx + 1);
  } else {
    const parts = fullPath.replace(/^\//, '').split('/');
    bucketName = parts[0];
    objectName = parts.slice(1).join('/');
  }

  const file = storage.bucket(bucketName).file(objectName);
  const [exists] = await file.exists();
  if (!exists) throw new Error(`Object not found: gs://${bucketName}/${objectName}`);

  await file.setMetadata({
    metadata: { [ACL_POLICY_METADATA_KEY]: JSON.stringify({ owner: 'system', visibility: 'public' }) },
  });
}

const sql = postgres(DATABASE_URL, { max: 1 });

const videos = await sql`SELECT id, video_path, thumbnail_path FROM videos`;
console.log(`Found ${videos.length} videos to patch`);

let ok = 0, errors = 0;
for (const video of videos) {
  const paths = [video.video_path, video.thumbnail_path].filter(Boolean);
  for (const p of paths) {
    try {
      await setPublicAcl(p);
      console.log(`✓  video ${video.id} — ${p}`);
      ok++;
    } catch (err) {
      console.error(`✗  video ${video.id} — ${p}: ${err.message}`);
      errors++;
    }
  }
}

await sql.end();
console.log(`\nDone: ${ok} patched, ${errors} errors`);
