import { Router, type IRouter } from "express";
import healthRouter from "./health";
import universeRouter from "./universe";
import storageRouter from "./storage";
import charactersRouter from "./characters";

const router: IRouter = Router();

router.use(healthRouter);
router.use(universeRouter);
router.use(storageRouter);
router.use(charactersRouter);

export default router;
