import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { badRequest, unsupportedMediaType } from "../errors.js";
import { giteaReviewBotService } from "../services/gitea/review-bot.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

const createReviewBotSchema = z.object({
  connectionId: z.string().guid(),
  agentId: z.string().guid(),
  repositories: z.array(z.string().trim().min(3).max(200)).min(1).max(100),
  statusContext: z.string().trim().min(1).max(100).optional(),
}).strict();

/** Gitea review bots (board) and their public, signature-verified webhook ingress. */
export function giteaRoutes(db: Db) {
  const router = Router();
  const bots = giteaReviewBotService(db);

  router.get("/companies/:companyId/gitea/review-bots", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    res.json(await bots.list(companyId));
  });

  router.post("/companies/:companyId/gitea/review-bots", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const input = createReviewBotSchema.parse(req.body ?? {});
    const userId = req.actor.type === "board" ? req.actor.userId ?? null : null;
    res.status(201).json(await bots.create(companyId, input, { userId }));
  });

  router.delete("/companies/:companyId/gitea/review-bots/:botId", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    const userId = req.actor.type === "board" ? req.actor.userId ?? null : null;
    res.json(await bots.remove(companyId, req.params.botId as string, { userId }));
  });

  // Public: authenticated by the routine trigger's HMAC (X-Hub-Signature-256), not a session.
  router.post("/gitea/review-bots/:publicId/webhook", async (req, res) => {
    if (!req.is("application/json")) throw unsupportedMediaType("Configure the Gitea webhook with content type application/json");
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) throw badRequest("Webhook payload must be a JSON object");
    const result = await bots.handleWebhook(req.params.publicId as string, {
      event: req.header("x-gitea-event") ?? req.header("x-github-event") ?? null,
      deliveryId: req.header("x-gitea-delivery") ?? null,
      hubSignature: req.header("x-hub-signature-256") ?? null,
      rawBody: (req as { rawBody?: Buffer }).rawBody ?? null,
      body: req.body,
    });
    res.status(202).json(result);
  });

  return router;
}
