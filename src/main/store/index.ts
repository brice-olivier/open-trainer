import path from 'path';
import { app } from 'electron';
import PersistentStore from './persistentStore';

let storePromise: Promise<PersistentStore> | undefined;

export const getStore = (): Promise<PersistentStore> => {
  if (!storePromise) {
    const dataDir = app.getPath('userData');
    storePromise = PersistentStore.initialize(path.join(dataDir, 'storage'));
  }
  return storePromise;
};

export default getStore;

