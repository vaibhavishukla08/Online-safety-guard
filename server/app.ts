/**
 * Express application factory — used by server.ts (real listener, Vite in dev,
 * static dist in production) and by scripts/smoke.ts (API-only, in-memory DB).
 *
 * Route map:
 *   /api/auth/*           sign-up / sign-in / session / add-in linking
 *   /api/connections/*    Outlook & Gmail OAuth, sync, disconnect
 *   /api/mail/*           mailbox history + on-demand analysis (own records only)
 *   /api/notifications/*  in-app security notifications
 *   /api/admin/*          role-gated admin dashboard APIs
 *   /api/*                investigation pipeline, add-in channel, coach, legacy endpoints
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import { attachUser } from './auth/middleware';
import { apiRouter } from './routes/api';
import { legacyRouter } from './routes/legacy';
import { authRouter } from './routes/auth';
import { connectionsRouter } from './routes/connections';
import { mailRouter } from './routes/mail';
import { notificationsRouter } from './routes/notifications';
import { adminRouter } from './routes/admin';
import { describeError } from './routes/errors';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  // Render (and most PaaS) terminate TLS at a proxy: needed for req.ip, req.secure and secure cookies.
  app.set('trust proxy', 1);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // No X-Frame-Options: the Outlook task pane is legitimately framed by Outlook.
    next();
  });

  app.use(express.json({ limit: '15mb' }));

  // Malformed JSON bodies should produce a clear 400, not a stack trace.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in (err as object)) {
      res.status(400).json({ error: 'Malformed JSON body.', code: 'bad_request' });
      return;
    }
    next(err);
  });

  app.use('/api', attachUser);
  app.use('/api/auth', authRouter);
  app.use('/api/connections', connectionsRouter);
  app.use('/api/mail', mailRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', apiRouter);
  app.use('/api', legacyRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Unknown API endpoint.', code: 'not_found' });
  });

  return app;
}

/** Final safety net: anything thrown inside a route becomes a JSON error, never an HTML stack trace. */
export function installErrorHandler(app: express.Express): void {
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const { status, message, code } = describeError(err);
    if (res.headersSent) {
      res.end();
      return;
    }
    if (req.path.startsWith('/api/')) res.status(status).json({ error: message, code });
    else res.status(status).type('text/plain').send(message);
  });
}
