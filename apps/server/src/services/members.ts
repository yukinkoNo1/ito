import {
  type Clock,
  graphemes,
  MEMBER_COLORS,
  type MemberColor,
  normalizeLogin,
  normalizeText,
  truncateGraphemes,
  uuidv7,
} from '@ito/core';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db, DbLike } from '../db/client';
import { type MemberRow, members } from '../db/schema';

const NAME_MAX = 20;

/** 有効なメンバーを作成順（created_at、同じなら id）で */
export function listActiveMembers(db: DbLike): MemberRow[] {
  return db
    .select()
    .from(members)
    .where(isNull(members.disabledAt))
    .orderBy(asc(members.createdAt), asc(members.id))
    .all();
}

export function listAllMembers(db: DbLike): MemberRow[] {
  return db.select().from(members).orderBy(asc(members.createdAt), asc(members.id)).all();
}

export function findMemberByLogin(db: DbLike, login: string): MemberRow | undefined {
  return db
    .select()
    .from(members)
    .where(eq(members.login, normalizeLogin(login)))
    .get();
}

export function findMemberById(db: DbLike, id: string): MemberRow | undefined {
  return db.select().from(members).where(eq(members.id, id)).get();
}

export function isNameTaken(db: DbLike, name: string, exceptId?: string): boolean {
  const row = db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.name, normalizeText(name)), isNull(members.disabledAt)))
    .get();
  return row !== undefined && row.id !== exceptId;
}

export function isColorTaken(db: DbLike, color: string, exceptId?: string): boolean {
  const row = db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.color, color), isNull(members.disabledAt)))
    .get();
  return row !== undefined && row.id !== exceptId;
}

/**
 * 名前がほかの有効なメンバーとぶつかったら、20 文字に収まるように末尾に 2, 3… を付ける（RUNBOOK 3.・SPEC §24 D17）
 */
export function uniqueName(base: string, taken: ReadonlySet<string>): string {
  const name = truncateGraphemes(normalizeText(base), NAME_MAX);
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) {
    const suffix = String(n);
    const head = truncateGraphemes(name, NAME_MAX - suffix.length);
    const candidate = `${head}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** §22 の順で、まだ使われていない最初の色 */
export function firstFreeColor(used: ReadonlySet<string>): MemberColor | null {
  return MEMBER_COLORS.find((c) => !used.has(c)) ?? null;
}

/**
 * ADMIN_LOGINS に含まれるログインの初回アクセスで、管理者として自動登録する（SPEC §14）。
 * 表示名は Tailscale-User-Name（デコード済み）か、ログインの @ より前。上限に達していたら null。
 */
export function autoRegisterAdmin(
  db: Db,
  clock: Clock,
  maxMembers: number,
  login: string,
  displayName: string | undefined,
): MemberRow | null {
  return db.transaction((tx) => {
    const active = listActiveMembers(tx);
    if (active.length >= maxMembers) return null;
    const normalizedLogin = normalizeLogin(login);
    const fallback = normalizedLogin.split('@')[0] ?? normalizedLogin;
    const base = normalizeText(displayName ?? '') || fallback || 'メンバー';
    const name = uniqueName(base, new Set(active.map((m) => m.name)));
    const color = firstFreeColor(new Set(active.map((m) => m.color)));
    if (!color) return null;
    const now = clock.now();
    const row: MemberRow = {
      id: uuidv7(now),
      login: normalizedLogin,
      name,
      mark: graphemes(name)[0] ?? '？',
      color,
      aliases: '[]',
      role: 'admin',
      settings: '{}',
      activityReadAt: 0,
      createdAt: now,
      updatedAt: now,
      disabledAt: null,
    };
    tx.insert(members).values(row).run();
    return row;
  });
}
