import { createContext, useContext } from 'react';

import type { DeviceStore } from './data/deviceStore.ts';
import type { PublicBundle } from './data/loadPublicData.ts';

export const BundleContext = createContext<PublicBundle | null>(null);
export const DeviceStoreContext = createContext<DeviceStore | null>(null);

export function useBundle(): PublicBundle {
  const value = useContext(BundleContext);
  if (!value) throw new Error('公開データが読み込まれていません。');
  return value;
}

export function useDeviceStore(): DeviceStore {
  const value = useContext(DeviceStoreContext);
  if (!value) throw new Error('端末内データ機能が初期化されていません。');
  return value;
}
