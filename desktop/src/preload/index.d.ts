import type { TalkBridge } from "../shared/ipc";

declare global {
  interface Window {
    talk: TalkBridge;
  }
}

export {};
