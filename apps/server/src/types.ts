import type { MemberRow } from './db/schema';

export interface FeedTokenContext {
  id: string;
  name: string;
}

export type AppEnv = {
  Variables: {
    /** identity を通った本人（/api/feed/* 以外） */
    me: MemberRow;
    /** feedAuth を通った連携キー（/api/feed/* だけ） */
    feedToken: FeedTokenContext;
  };
};
