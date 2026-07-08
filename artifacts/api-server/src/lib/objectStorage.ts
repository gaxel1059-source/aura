import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import {
  canAccessObject,
  getObjectAclPolicy,
  ObjectAclPolicy,
  ObjectPermission,
  setObjectAclPolicy,
} from './objectAcl';

// Any S3-compatible provider works here (Backblaze B2, Cloudflare R2, MinIO, ...).
// Backblaze B2: endpoint like https://s3.us-west-002.backblazeb2.com, region "us-west-002".
export const objectStorageClient = new S3Client({
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  },
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super('Object not found');
    this.name = 'ObjectNotFoundError';
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// Reference to a single object in the bucket — replaces the GCS `File` handle.
export interface ObjectRef {
  bucket: string;
  key: string;
}

async function objectExists(ref: ObjectRef): Promise<boolean> {
  try {
    await objectStorageClient.send(
      new HeadObjectCommand({ Bucket: ref.bucket, Key: ref.key }),
    );
    return true;
  } catch (err) {
    if (isNotFoundError(err)) return false;
    throw err;
  }
}

function isNotFoundError(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  const status = (err as { $metadata?: { httpStatusCode?: number } })
    ?.$metadata?.httpStatusCode;
  return name === 'NotFound' || name === 'NoSuchKey' || status === 404;
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || '';
    const paths = Array.from(
      new Set(
        pathsStr
          .split(',')
          .map((path) => path.trim())
          .filter((path) => path.length > 0),
      ),
    );
    if (paths.length === 0) {
      throw new Error(
        'PUBLIC_OBJECT_SEARCH_PATHS not set (comma-separated /bucket/prefix paths).',
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || '';
    if (!dir) {
      throw new Error('PRIVATE_OBJECT_DIR not set (expects /bucket/prefix).');
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<ObjectRef | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;
      const ref = parseObjectPath(fullPath);
      if (await objectExists(ref)) {
        return ref;
      }
    }

    return null;
  }

  async downloadObject(
    ref: ObjectRef,
    rangeHeader: string | null = null,
    cacheTtlSec: number = 3600,
  ): Promise<Response> {
    const head = await objectStorageClient.send(
      new HeadObjectCommand({ Bucket: ref.bucket, Key: ref.key }),
    );
    const aclPolicy = await getObjectAclPolicy(ref);
    const isPublic = aclPolicy?.visibility === 'public';
    const contentType = head.ContentType || 'application/octet-stream';
    const cacheControl = `${isPublic ? 'public' : 'private'}, max-age=${cacheTtlSec}`;
    const totalSize = head.ContentLength ?? null;

    // Handle Range requests (required for <video> seeking) — RFC 9110 §14.2
    if (rangeHeader && totalSize !== null) {
      const suffixMatch = rangeHeader.match(/^bytes=-(\d+)$/);
      const rangeMatch = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);

      let start: number, end: number;

      if (suffixMatch) {
        const suffixLen = parseInt(suffixMatch[1], 10);
        start = Math.max(0, totalSize - suffixLen);
        end = totalSize - 1;
      } else if (rangeMatch) {
        start = parseInt(rangeMatch[1], 10);
        end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : totalSize - 1;
      } else {
        start = 0;
        end = totalSize - 1;
      }

      // Validate bounds (RFC 9110 §14.1.2) — return 416 if unsatisfiable
      if (start > end || start >= totalSize || end >= totalSize) {
        return new Response(null, {
          status: 416,
          headers: {
            'Content-Range': `bytes */${totalSize}`,
            'Accept-Ranges': 'bytes',
          },
        });
      }

      const chunkSize = end - start + 1;
      const getResp = await objectStorageClient.send(
        new GetObjectCommand({
          Bucket: ref.bucket,
          Key: ref.key,
          Range: `bytes=${start}-${end}`,
        }),
      );
      const nodeStream = getResp.Body as Readable;
      const webStream = Readable.toWeb(nodeStream) as ReadableStream;

      return new Response(webStream, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Cache-Control': cacheControl,
        },
      });
    }

    const getResp = await objectStorageClient.send(
      new GetObjectCommand({ Bucket: ref.bucket, Key: ref.key }),
    );
    const nodeStream = getResp.Body as Readable;
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControl,
    };
    if (totalSize !== null) {
      headers['Content-Length'] = String(totalSize);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;
    const ref = parseObjectPath(fullPath);

    return getSignedUrl(
      objectStorageClient,
      new PutObjectCommand({ Bucket: ref.bucket, Key: ref.key }),
      { expiresIn: 900 },
    );
  }

  async getObjectEntityFile(objectPath: string): Promise<ObjectRef> {
    if (!objectPath.startsWith('/objects/')) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split('/');
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join('/');
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith('/')) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const ref = parseObjectPath(objectEntityPath);
    if (!(await objectExists(ref))) {
      throw new ObjectNotFoundError();
    }
    return ref;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    // Presigned upload URLs are absolute, pointing at our configured S3-compatible
    // endpoint (Backblaze B2, R2, MinIO, ...). Anything else is already relative.
    let url: URL;
    try {
      url = new URL(rawPath);
    } catch {
      return rawPath;
    }
    const endpoint = process.env.S3_ENDPOINT;
    const endpointHost = endpoint ? new URL(endpoint).hostname : '';
    if (!endpointHost || url.hostname !== endpointHost) {
      return rawPath;
    }

    // Path-style URL: /<bucket>/<key> — same "/bucket/prefix" shape as
    // PRIVATE_OBJECT_DIR below, so compare directly.
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith('/')) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith('/')) {
      return normalizedPath;
    }

    const ref = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(ref, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: ObjectRef;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): ObjectRef {
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  const pathParts = path.split('/');
  if (pathParts.length < 3) {
    throw new Error('Invalid path: must contain at least a bucket name');
  }

  const bucket = pathParts[1];
  const key = pathParts.slice(2).join('/');

  return { bucket, key };
}

export async function getObjectMetadata(
  ref: ObjectRef,
): Promise<Record<string, string>> {
  const head = await objectStorageClient.send(
    new HeadObjectCommand({ Bucket: ref.bucket, Key: ref.key }),
  );
  return head.Metadata || {};
}

export async function setObjectMetadata(
  ref: ObjectRef,
  metadata: Record<string, string>,
): Promise<void> {
  await objectStorageClient.send(
    new CopyObjectCommand({
      Bucket: ref.bucket,
      Key: ref.key,
      CopySource: `${ref.bucket}/${encodeURIComponent(ref.key)}`,
      Metadata: metadata,
      MetadataDirective: 'REPLACE',
    }),
  );
}

export { objectExists };
