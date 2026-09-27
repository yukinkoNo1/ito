import {
  type AdminMemberDTO,
  loginSchema,
  memberCreateSchema,
  memberPatchSchema,
  uuidSchema,
} from '@ito/core';
import type { App, AppDeps } from '../app';
import type { MemberRow } from '../db/schema';
import { ApiError } from '../errors';
import { parseBody, parseWith } from '../lib/validate';
import { addMember, listAllMembers, updateMember } from '../services/members';
import { toMemberDto } from '../services/sync';

export type DeviceCounter = (memberId: string) => number;

function toAdminDto(m: MemberRow, deviceCount: number): AdminMemberDTO {
  return { ...toMemberDto(m), login: m.login, deviceCount };
}

function requireAdmin(me: MemberRow): void {
  if (me.role !== 'admin') throw new ApiError(403, 'forbidden', '家族の管理は管理者だけができます');
}

/** 家族の管理（§13。POST・PATCH は管理者のみ。ログインは管理者にだけ返す） */
export function registerMemberRoutes(
  app: App,
  deps: AppDeps,
  deviceCount: DeviceCounter = () => 0,
): void {
  const { db, clock, env } = deps;

  app.get('/api/members', (c) => {
    const me = c.get('me');
    const all = listAllMembers(db);
    if (me.role === 'admin')
      return c.json({ members: all.map((m) => toAdminDto(m, deviceCount(m.id))) });
    return c.json({ members: all.map(toMemberDto) });
  });

  app.post('/api/members', async (c) => {
    requireAdmin(c.get('me'));
    const input = await parseBody(c, memberCreateSchema);
    const login = parseWith(loginSchema, input.login);
    const row = addMember(db, clock, env.MAX_MEMBERS, { ...input, login });
    return c.json({ member: toAdminDto(row, 0) }, 201);
  });

  app.patch('/api/members/:id', async (c) => {
    requireAdmin(c.get('me'));
    const id = parseWith(uuidSchema, c.req.param('id'));
    const patch = await parseBody(c, memberPatchSchema);
    const row = updateMember(db, clock, env.MAX_MEMBERS, id, patch);
    return c.json({ member: toAdminDto(row, deviceCount(row.id)) });
  });
}
