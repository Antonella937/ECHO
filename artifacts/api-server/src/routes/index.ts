import { Router, type IRouter } from "express";
import healthRouter from "./health";
import universeRouter from "./universe";
import storageRouter from "./storage";
import charactersRouter from "./characters";
import aiEngineRouter from "./ai-engine";
import autonomyRouter from "./autonomy";
import creatorRouter from "./creator";
import { characterPrivacyRouter } from "./character-privacy";

const router: IRouter = Router();

router.use(healthRouter);
router.use(universeRouter);
router.use(storageRouter);
router.use(charactersRouter);
router.use(aiEngineRouter);
router.use(autonomyRouter);
router.use(creatorRouter);
router.use(characterPrivacyRouter);

export default router;
