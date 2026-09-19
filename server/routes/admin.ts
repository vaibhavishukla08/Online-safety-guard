/**
 * Admin routes — every handler sits behind requireAdmin (role === 'ADMIN').
 *
 *   GET   /api/admin/overview
 *   GET   /api/admin/users
 *   PATCH /api/admin/users/:id      {status?: 'active'|'suspended', role?: 'USER'|'ADMIN'}
 *   GET   /api/admin/threats
 *   GET   /api/admin/health
 *   GET   /api/admin/audit?limit=&offset=&userId=&action=
 */
import { Router } from 'express';
import { handleError } from './errors';
import { clientIp, requireAdmin } from '../auth/middleware';
import { adminOverview, adminUsers, threatAnalytics } from '../services/admin';
import { getServiceHealth } from '../services/health';
import { rateLimitStats } from '../utils/http';
import { audit, listAudit } from '../services/audit';
import { findUserById, setUserRole, setUserStatus } from '../services/users';
import { InvestigationError } from '../agents/orchestrator';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

adminRouter.get('/overview', async (_req, res) => {
  try {
    res.json(await adminOverview());
  } catch (error) {
    handleError(error, res);
  }
});

adminRouter.get('/users', async (_req, res) => {
  try {
    res.json({ users: await adminUsers() });
  } catch (error) {
    handleError(error, res);
  }
});

adminRouter.patch('/users/:id', async (req, res) => {
  try {
    const target = await findUserById(String(req.params.id));
    if (!target) throw new InvestigationError(404, 'User not found.', 'not_found');
    if (target.id === req.auth!.user.id) throw new InvestigationError(400, 'You cannot change your own role or status.', 'bad_request');
    const body = (req.body || {}) as Record<string, unknown>;
    const changes: Record<string, string> = {};
    if (body.status !== undefined) {
      if (body.status !== 'active' && body.status !== 'suspended') throw new InvestigationError(400, 'status must be active or suspended.', 'bad_request');
      await setUserStatus(target.id, body.status);
      changes.status = body.status;
    }
    if (body.role !== undefined) {
      if (body.role !== 'USER' && body.role !== 'ADMIN') throw new InvestigationError(400, 'role must be USER or ADMIN.', 'bad_request');
      await setUserRole(target.id, body.role);
      changes.role = body.role;
    }
    await audit('admin_action', { userId: req.auth!.user.id, actorRole: 'ADMIN', detail: { targetUserId: target.id, ...changes }, ip: clientIp(req) });
    res.json({ ok: true, changes });
  } catch (error) {
    handleError(error, res);
  }
});

adminRouter.get('/threats', async (_req, res) => {
  try {
    res.json(await threatAnalytics());
  } catch (error) {
    handleError(error, res);
  }
});

adminRouter.get('/health', async (_req, res) => {
  try {
    res.json(await getServiceHealth(rateLimitStats().activeClients));
  } catch (error) {
    handleError(error, res);
  }
});

adminRouter.get('/audit', async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    res.json(await listAudit({ limit, offset, userId: typeof req.query.userId === 'string' ? req.query.userId : undefined, action: typeof req.query.action === 'string' ? req.query.action : undefined }));
  } catch (error) {
    handleError(error, res);
  }
});
