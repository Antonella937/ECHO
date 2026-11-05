import { Router, type IRouter } from 'express';
import imageGenerationRouter from './image-generation';
import { brainPreviewRouter } from './brain-preview';
import { visionAnalysisRouter } from './vision-analysis';

const router: IRouter = Router();
router.use(imageGenerationRouter);
router.use(visionAnalysisRouter);
router.use(brainPreviewRouter);

export default router;
