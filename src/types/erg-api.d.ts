import type { ErgApi } from '../preload/index';

declare global {
  interface Window {
    ergApi: ErgApi;
  }
}

export {};
