/**
 * Admin / migration routes — development only.
 * POST /admin/migrate-video-acls  — sets public-read ACL on all DB-stored video objects.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, videosTable } from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

const PUBLIC_POLICY = { owner: "system", visibility: "public" as const };

// Gate: only mount the route in non-production environments.
if (process.env.NODE_ENV !== "production") {
  const MIGRATION_SECRET = process.env.MIGRATION_SECRET ?? "";

  router.post("/admin/migrate-video-acls", async (req: Request, res: Response): Promise<void> => {
    // Require a secret header that callers must supply; value comes from env, never source.
    if (!MIGRATION_SECRET || req.headers["x-migration-secret"] !== MIGRATION_SECRET) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    try {
      // Only operate on DB-backed records — no caller-supplied paths allowed.
      const videos = await db
        .select({ id: videosTable.id, videoPath: videosTable.videoPath, thumbnailPath: videosTable.thumbnailPath })
        .from(videosTable);

      const results: Array<{ id: number; status: string; path: string }> = [];

      for (const video of videos) {
        for (const [label, p] of [["video", video.videoPath], ["thumb", video.thumbnailPath]] as [string, string | null][]) {
          if (!p) continue;
          try {
            await objectStorage.trySetObjectEntityAclPolicy(p, PUBLIC_POLICY);
            results.push({ id: video.id, status: `ok-${label}`, path: p });
          } catch (err) {
            results.push({ id: video.id, status: `error-${label}: ${(err as Error).message}`, path: p });
          }
        }
      }

      const ok = results.filter((r) => r.status.startsWith("ok")).length;
      const errors = results.filter((r) => r.status.startsWith("error")).length;
      res.json({ patched: ok, errors, results });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
}

export default router;
