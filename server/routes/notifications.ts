/**
 * In-app notification routes (own notifications only).
 *
 *   GET  /api/notifications?status=unread|active|all&limit=
 *   POST /api/notifications/read-all
 *   POST /api/notifications/:id/read | /dismiss | /unread
 */
import { Router } from 'express';
import { handleError } from './errors';
import { requireAuth } from '../auth/middleware';
import { listNotifications, markAllRead, setNotificationStatus } from '../services/notifications';
import { InvestigationError } from '../agents/orchestrator';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' && ['unread', 'active', 'all'].includes(req.query.status) ? (req.query.status as 'unread' | 'active' | 'all') : 'active';
    res.json(await listNotifications(req.auth!.user.id, { status, limit: Number(req.query.limit) || 30 }));
  } catch (error) {
    handleError(error, res);
  }
});

notificationsRouter.post('/read-all', async (req, res) => {
  try {
    await markAllRead(req.auth!.user.id);
    res.json({ ok: true });
  } catch (error) {
    handleError(error, res);
  }
});

for (const action of ['read', 'dismiss', 'unread'] as const) {
  notificationsRouter.post(`/:id/${action}`, async (req, res) => {
    try {
      const status = action === 'dismiss' ? 'dismissed' : action;
      const ok = await setNotificationStatus(req.auth!.user.id, String(req.params.id), status);
      if (!ok) throw new InvestigationError(404, 'Notification not found.', 'not_found');
      res.json({ ok: true });
    } catch (error) {
      handleError(error, res);
    }
  });
}
