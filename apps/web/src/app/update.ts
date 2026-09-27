import { createContext, useContext } from 'react';

/** 新しい SW が待機しているときの「更新」（なければ null。§17） */
export const UpdateContext = createContext<(() => void) | null>(null);

export function useUpdate(): (() => void) | null {
  return useContext(UpdateContext);
}
