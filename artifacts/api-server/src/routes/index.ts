import { Router, type IRouter } from "express";
import healthRouter from "./health";
import universeRouter from "./universe";
import storageRouter from "./storage";
import charactersRouter from "./characters";
import aiEngineRouter from "./ai-engine";

const router: IRouter = Router();

router.use(healthRouter);
router.use(universeRouter);
router.use(storageRouter);
router.use(charactersRouter);
router.use(aiEngineRouter);

export default router;
