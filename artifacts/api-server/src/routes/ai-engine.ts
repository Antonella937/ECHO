import { Router, type IRouter } from 'express';
import aiTweakRouter from './ai-tweak';
import imageGenerationRouter from './image-generation';
import { brainPreviewRouter } from './brain-preview';
import { visionAnalysisRouter } from './vision-analysis';
import { kindroidConnectionCheckRouter } from './kindroid-connection-check';

const router: IRouter = Router();
router.use(imageGenerationRouter);
router.use(aiTweakRouter);
router.use(visionAnalysisRouter);
router.use(brainPreviewRouter);
router.use(kindroidConnectionCheckRouter);

export default router;
