import { Readable } from 'stream';
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from '@workspace/api-zod';
import { Router, type IRouter, type Request, type Response } from 'express';
import { getAuth } from '@clerk/express';

import { ObjectPermission } from '../lib/objectAcl';
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from '../lib/objectStorage';

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Mints an objectId and returns a same-origin upload URL — the browser PUTs
 * the file to this server (see /storage/uploads/proxy/:objectId below),
 * which then streams it to the bucket server-to-server. This sidesteps the
 * bucket's own CORS setup entirely: the browser never talks to the bucket
 * directly, only to this API.
 * Requires Clerk auth so public callers cannot mint write-capable URLs.
 */
router.post(
  '/storage/uploads/request-url',
  async (req: Request, res: Response) => {
    const auth = getAuth(req);
    if (!auth?.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Missing or invalid required fields' });
      return;
    }

    try {
      const { name, size, contentType } = parsed.data;

      const { objectId } = objectStorageService.buildNewUploadRef();

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL: `/api/storage/uploads/proxy/${objectId}`,
          objectPath: `/objects/uploads/${objectId}`,
          metadata: { name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, 'Error generating upload URL');
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  },
);

/**
 * PUT /storage/uploads/proxy/:objectId
 *
 * Receives the file bytes from the browser (same-origin, no CORS) and
 * streams them on to the bucket using a freshly-signed URL. objectId must
 * match one just minted by /storage/uploads/request-url — the bucket path
 * is rebuilt deterministically from it, so there's nothing to look up.
 */
router.put(
  '/storage/uploads/proxy/:objectId',
  async (req: Request, res: Response) => {
    const auth = getAuth(req);
    if (!auth?.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    try {
      const objectId = Array.isArray(req.params.objectId)
        ? req.params.objectId[0]
        : req.params.objectId;
      const ref = objectStorageService.buildUploadRefForId(objectId);
      const presignedUrl = await objectStorageService.getPresignedPutUrl(ref);

      const upstream = await fetch(presignedUrl, {
        method: 'PUT',
        duplex: 'half',
        body: req,
        headers: {
          'Content-Type':
            req.headers['content-type'] || 'application/octet-stream',
          // Required by the bucket — without it the upstream PUT is
          // rejected with 411 Length Required.
          'Content-Length': req.headers['content-length'] ?? '',
        },
      });

      if (!upstream.ok) {
        req.log.error(
          { status: upstream.status, body: await upstream.text() },
          'Upstream upload to bucket failed',
        );
        res.status(502).json({ error: 'Failed to store file' });
        return;
      }

      res.status(204).end();
    } catch (error) {
      req.log.error({ err: error }, 'Error proxying upload to bucket');
      res.status(500).json({ error: 'Failed to store file' });
    }
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get(
  '/storage/public-objects/*filePath',
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.filePath;
      const filePath = Array.isArray(raw) ? raw.join('/') : raw;
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      const response = await objectStorageService.downloadObject(file);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (response.body) {
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      req.log.error({ err: error }, 'Error serving public object');
      res.status(500).json({ error: 'Failed to serve public object' });
    }
  },
);

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * Protected: requires a valid Clerk session OR a video that is "ready" status
 * (public readable). For Phase 2 we allow authenticated users and treat all
 * ready videos as readable by anyone who is signed in. Unauthenticated reads
 * are rejected to prevent object path enumeration attacks.
 */
router.get('/storage/objects/*path', async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth?.userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join('/') : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile =
      await objectStorageService.getObjectEntityFile(objectPath);

    // ACL check: if the object has an explicit ACL policy, enforce it.
    // Objects without a policy (e.g. freshly uploaded videos) are accessible
    // to any authenticated user — Phase 3 will add per-user ownership policies.
    const canAccess = await objectStorageService.canAccessObjectEntity({
      userId: auth.userId,
      objectFile,
      requestedPermission: ObjectPermission.READ,
    });
    if (!canAccess) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const rangeHeader = req.headers.range;
    const response = await objectStorageService.downloadObject(
      objectFile,
      rangeHeader ?? null,
    );

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(
        response.body as ReadableStream<Uint8Array>,
      );
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, 'Object not found');
      res.status(404).json({ error: 'Object not found' });
      return;
    }
    req.log.error({ err: error }, 'Error serving object');
    res.status(500).json({ error: 'Failed to serve object' });
  }
});

export default router;
