import {
  type Clock,
  fitGraphemes,
  graphemes,
  MEMBER_COLORS,
  type MemberColor,
  nameKey,
  normalizeLogin,
  normalizeText,
  removeHiddenCharacters,
  uuidv7,
} from '@ito/core';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db, DbLike } from '../db/client';
import { changes, type MemberRow, members, pendingNotices } from '../db/schema';
import { ApiError } from '../errors';
import { deleteSubscriptionsOf } from './push';

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

/**
 * 有効なメンバーに同じ名前がいるか。見た目を変えない文字を除いた鍵で比べる（異体字セレクタや ZWJ を足して
 * ほかの家族と同じに見える名前にさせない。§10。総点検のレビュー C9）
 */
export function isNameTaken(db: DbLike, name: string, exceptId?: string): boolean {
  const key = nameKey(name);
  return listActiveMembers(db).some((m) => m.id !== exceptId && nameKey(m.name) === key);
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
 * 名前がほかの有効なメンバーとぶつかったら、20 文字に収まるように末尾に 2, 3… を付ける（RUNBOOK 3.・SPEC §24 D18）。
 * taken はほかのメンバーの名前。見た目を変えない文字を除いた鍵で比べ、長さは入力と同じ決まりに収める（C9・C10）
 */
export function uniqueName(base: string, taken: ReadonlySet<string>): string {
  const keys = new Set([...taken].map(nameKey));
  // 切り詰めたあとにも前後の空白を除く（比べるときの正規化と合わせる）
  const name = normalizeText(fitGraphemes(normalizeText(base), NAME_MAX));
  if (!keys.has(nameKey(name))) return name;
  for (let n = 2; ; n++) {
    const suffix = String(n);
    const head = normalizeText(fitGraphemes(name, NAME_MAX - suffix.length));
    const candidate = `${head}${suffix}`;
    if (!keys.has(nameKey(candidate))) return candidate;
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
    // 表示名の見えない文字・制御文字は除く（総点検 A6）
    // 長すぎる 1 文字は除き、名前の長さの上限に収める（C10）
    const clean = (value: string) =>
      normalizeText(fitGraphemes(removeHiddenCharacters(value), NAME_MAX));
    const base = clean(displayName ?? '') || clean(fallback) || 'メンバー';
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

export interface MemberUpdate {
  name?: string;
  mark?: string;
  color?: string;
  role?: 'admin' | 'member';
  disabled?: boolean;
  aliases?: string[];
  settings?: string;
}

function countActiveAdmins(db: DbLike, exceptId: string): number {
  return listActiveMembers(db).filter((m) => m.role === 'admin' && m.id !== exceptId).length;
}

/**
 * メンバーの追加（管理者）。名前（NFC・前後の空白除去のあと）と色は有効なメンバー間で重複不可、上限あり（§10）。
 */
export function addMember(
  db: Db,
  clock: Clock,
  maxMembers: number,
  input: { login: string; name: string; mark: string; color: string; role: 'admin' | 'member' },
): MemberRow {
  return db.transaction((tx) => {
    const login = normalizeLogin(input.login);
    if (findMemberByLogin(tx, login)) throw new ApiError(409, 'login_taken');
    if (listActiveMembers(tx).length >= maxMembers) throw new ApiError(409, 'member_limit');
    const name = normalizeText(input.name);
    if (isNameTaken(tx, name)) throw new ApiError(409, 'name_taken');
    if (isColorTaken(tx, input.color)) throw new ApiError(409, 'color_taken');
    const now = clock.now();
    const row: MemberRow = {
      id: uuidv7(now),
      login,
      name,
      mark: normalizeText(input.mark),
      color: input.color,
      aliases: '[]',
      role: input.role,
      settings: '{}',
      activityReadAt: 0,
      createdAt: now,
      updatedAt: now,
      disabledAt: null,
    };
    tx.insert(members).values(row).run();
    recordMemberChange(tx, row.id, now);
    return row;
  });
}

/**
 * メンバーの変更。名前・色の重複禁止は、変更と再有効化のどちらでも効かせる。
 * 最後の管理者は降格・無効化できない（§14）。
 */
export function updateMember(
  db: Db,
  clock: Clock,
  maxMembers: number,
  id: string,
  patch: MemberUpdate,
): MemberRow {
  return db.transaction((tx) => {
    const current = findMemberById(tx, id);
    if (!current) throw new ApiError(404, 'not_found');
    const willBeActive =
      patch.disabled === undefined ? current.disabledAt === null : !patch.disabled;
    const name = patch.name !== undefined ? normalizeText(patch.name) : current.name;
    const color = patch.color ?? current.color;
    const role = patch.role ?? current.role;
    if (willBeActive) {
      if (current.disabledAt !== null && listActiveMembers(tx).length >= maxMembers) {
        throw new ApiError(409, 'member_limit');
      }
      if (isNameTaken(tx, name, id)) throw new ApiError(409, 'name_taken');
      if (isColorTaken(tx, color, id)) throw new ApiError(409, 'color_taken');
    }
    const losingAdmin =
      current.role === 'admin' &&
      current.disabledAt === null &&
      (role !== 'admin' || !willBeActive);
    if (losingAdmin && countActiveAdmins(tx, id) === 0) throw new ApiError(409, 'last_admin');
    const now = clock.now();
    const next: MemberRow = {
      ...current,
      name,
      mark: patch.mark !== undefined ? normalizeText(patch.mark) : current.mark,
      color,
      role,
      aliases: patch.aliases !== undefined ? JSON.stringify(patch.aliases) : current.aliases,
      settings: patch.settings ?? current.settings,
      updatedAt: now,
      disabledAt: willBeActive ? null : (current.disabledAt ?? now),
    };
    tx.update(members).set(next).where(eq(members.id, id)).run();
    if (!willBeActive) {
      // 無効化したら、その人の端末への通知をすべて止める（§13・§18 T9）。まとめ待ちの変更通知も捨てる
      deleteSubscriptionsOf(tx, id);
      tx.delete(pendingNotices).where(eq(pendingNotices.recipientId, id)).run();
    }
    recordMemberChange(tx, id, now);
    return next;
  });
}

function recordMemberChange(db: DbLike, id: string, now: number): void {
  db.insert(changes).values({ entity: 'member', entityId: id, createdAt: now }).run();
}
