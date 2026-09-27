import type { App, AppDeps } from '../app';

export function registerMeRoutes(app: App, _deps: AppDeps): void {
  app.get('/api/me', (c) => {
    const me = c.get('me');
    return c.json({
      id: me.id,
      name: me.name,
      mark: me.mark,
      color: me.color,
      role: me.role,
    });
  });
}
