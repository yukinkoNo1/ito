import { ArrowLeft, ChevronRight, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { Button, Input } from '../primitives/Controls';
import type { AdminMemberVM, MemberColor, MembersAdminScreenProps } from '../types';
import { COLOR_LABELS } from './SettingsScreen';

/** S-07b 家族の管理（管理者）。書き出しにないので、設定と同じ部品（.settings-section・.setting-row）で作る */
export default function MembersAdminScreen({
  members,
  onBack,
  onAdd,
  onUpdate,
  onRevokeDevices,
}: MembersAdminScreenProps) {
  const [editing, setEditing] = useState<AdminMemberVM | null>(null);
  const [adding, setAdding] = useState(false);
  const active = members.filter((m) => !m.disabled);
  const takenBy = (color: MemberColor, except?: string) =>
    active.find((m) => m.color === color && m.id !== except)?.mark ?? null;

  return (
    <>
      <header className="secondary-header">
        <Button aria-label="戻る" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
        </Button>
        <div>
          <p>管理者だけ</p>
          <strong>家族の管理</strong>
        </div>
        <Button aria-label="家族を追加" onClick={() => setAdding(true)}>
          <UserPlus aria-hidden="true" />
        </Button>
      </header>
      <div className="settings-scroll">
        <section className="settings-section">
          <div className="settings-section-heading">
            <Users aria-hidden="true" />
            <strong>家族のメンバー（{active.length}人）</strong>
          </div>
          {members.map((member) => (
            <Button className="setting-row" key={member.id} onClick={() => setEditing(member)}>
              <span>
                <span className={`member-text--${member.color}`}>
                  {member.mark} {member.name}
                </span>
                <small className="setting-row-sub">{member.login}</small>
              </span>
              <span>
                <strong>
                  {[
                    member.role === 'admin' ? '管理者' : null,
                    member.disabled ? '無効' : null,
                    member.deviceCount > 0 ? `通知 ${member.deviceCount}台` : null,
                  ]
                    .filter(Boolean)
                    .join('・') || 'メンバー'}
                </strong>
                <ChevronRight aria-hidden="true" />
              </span>
            </Button>
          ))}
        </section>
      </div>

      {editing && (
        <div className="sheet-backdrop">
          <section
            aria-label={`${editing.name}を編集`}
            aria-modal="true"
            className="bottom-sheet setting-picker"
            role="dialog"
          >
            <div className="sheet-title">
              <strong>{editing.name}</strong>
              <Button onClick={() => setEditing(null)}>閉じる</Button>
            </div>
            <div className="thread-color-picker">
              {(Object.keys(COLOR_LABELS) as MemberColor[]).map((color) => {
                const by = takenBy(color, editing.id);
                return (
                  <Button
                    aria-pressed={editing.color === color}
                    className={`thread-color thread-color--${color}`}
                    disabled={Boolean(by)}
                    key={color}
                    onClick={() => {
                      onUpdate(editing.id, { color });
                      setEditing(null);
                    }}
                  >
                    <i />
                    <span>{COLOR_LABELS[color]}</span>
                    {by && <small>{by}が使用中</small>}
                  </Button>
                );
              })}
            </div>
            <div className="setting-picker-options">
              <Button
                onClick={() => {
                  onUpdate(editing.id, { role: editing.role === 'admin' ? 'member' : 'admin' });
                  setEditing(null);
                }}
              >
                {editing.role === 'admin' ? 'メンバーにする' : '管理者にする'}
              </Button>
              <Button
                onClick={() => {
                  onUpdate(editing.id, { disabled: !editing.disabled });
                  setEditing(null);
                }}
              >
                {editing.disabled ? '有効にする' : '無効にする（端末の通知も止める）'}
              </Button>
              <Button
                onClick={() => {
                  onRevokeDevices(editing.id);
                  setEditing(null);
                }}
              >
                この人の端末の通知を止める
              </Button>
            </div>
          </section>
        </div>
      )}

      {adding && (
        <AddMemberSheet
          onAdd={(input) => {
            onAdd(input);
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
          takenBy={(color) => takenBy(color)}
        />
      )}
    </>
  );
}

function AddMemberSheet({
  onAdd,
  onClose,
  takenBy,
}: {
  onAdd: MembersAdminScreenProps['onAdd'];
  onClose: () => void;
  takenBy: (color: MemberColor) => string | null;
}) {
  const [login, setLogin] = useState('');
  const [name, setName] = useState('');
  const [mark, setMark] = useState('');
  const [color, setColor] = useState<MemberColor | null>(
    () => (Object.keys(COLOR_LABELS) as MemberColor[]).find((c) => !takenBy(c)) ?? null,
  );
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const canAdd = login.includes('@') && name.trim() && mark.trim() && color;
  return (
    <div className="sheet-backdrop">
      <section
        aria-label="家族を追加"
        aria-modal="true"
        className="bottom-sheet setting-picker"
        role="dialog"
      >
        <div className="sheet-title">
          <strong>家族を追加</strong>
          <Button onClick={onClose}>閉じる</Button>
        </div>
        <form
          className="setting-text-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (canAdd && color)
              onAdd({ login: login.trim(), name: name.trim(), mark: mark.trim(), color, role });
          }}
        >
          <Input
            aria-label="ログイン（Tailscale）"
            onChange={(e) => setLogin(e.target.value)}
            placeholder="mama@example.com"
            type="email"
            value={login}
          />
          <Input
            aria-label="名前"
            onChange={(e) => setName(e.target.value)}
            placeholder="お母さん"
            value={name}
          />
          <Input
            aria-label="略称（1 文字）"
            maxLength={2}
            onChange={(e) => setMark(e.target.value)}
            placeholder="母"
            value={mark}
          />
          <div className="thread-color-picker">
            {(Object.keys(COLOR_LABELS) as MemberColor[]).map((c) => {
              const by = takenBy(c);
              return (
                <Button
                  aria-pressed={color === c}
                  className={`thread-color thread-color--${c}`}
                  disabled={Boolean(by)}
                  key={c}
                  onClick={() => setColor(c)}
                  type="button"
                >
                  <i />
                  <span>{COLOR_LABELS[c]}</span>
                  {by && <small>{by}が使用中</small>}
                </Button>
              );
            })}
          </div>
          <div className="setting-picker-options">
            <Button
              aria-pressed={role === 'member'}
              onClick={() => setRole('member')}
              type="button"
            >
              メンバー
            </Button>
            <Button aria-pressed={role === 'admin'} onClick={() => setRole('admin')} type="button">
              管理者
            </Button>
          </div>
          <Button disabled={!canAdd} type="submit" variant="accent">
            追加
          </Button>
        </form>
      </section>
    </div>
  );
}
