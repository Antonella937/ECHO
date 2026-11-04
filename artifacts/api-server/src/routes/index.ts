import { Router, type IRouter } from "express";
import healthRouter from "./health";
import universeRouter from "./universe";
import universeSharingRouter from "./universe-sharing";
import storageRouter from "./storage";
import { createSupabaseStorageRouter } from "./supabase-storage";
import charactersRouter from "./characters";
import aiEngineRouter from "./ai-engine";
import autonomyRouter from "./autonomy";
import creatorRouter from "./creator";
import { characterPrivacyRouter } from "./character-privacy";
import { socialFollowsRouter } from "./social-follows";
import { socialReadRouter } from "./social-reads";
import { createOwnerConsentRouter } from "./owner-consent";
import { createConsentSafetyGate } from "../middlewares/consentSafety";

const router: IRouter = Router();
router.use(createConsentSafetyGate());
router.use(createOwnerConsentRouter());

router.use(healthRouter);
router.use(universeRouter);
router.use(universeSharingRouter);
router.use(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createSupabaseStorageRouter() : storageRouter);
router.use(charactersRouter);
router.use(aiEngineRouter);
router.use(autonomyRouter);
router.use(creatorRouter);
router.use(characterPrivacyRouter);
router.use(socialFollowsRouter);
router.use(socialReadRouter);

export default router;
