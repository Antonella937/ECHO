import { Router, type IRouter } from 'express';
import { requireAuth } from '../middlewares/requireAuth';

const router: IRouter = Router();
const status = {
  available: false,
  reason: 'La creación asistida todavía no tiene un proveedor configurado. No se envió tu descripción a ningún servicio. Podés crear y editar el personaje manualmente.',
};
router.use('/characters/assistance', requireAuth);
router.get('/characters/assistance', (_req, res) => { res.json(status); });
router.post('/characters/assistance', (_req, res) => {
  // Adapter boundary only. Never claim generation or create an account on failure.
  res.status(503).json({ error: status.reason, code: 'CHARACTER_ASSISTANCE_UNAVAILABLE' });
});
export default router;
