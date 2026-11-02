// "Test microphone & system audio" (Settings): runs the helper's selftest.run, which captures
// both sides locally for a few seconds (nothing sent or saved) and streams `levels` meanwhile.
// One at a time, never during a recording (the helper refuses too: `busy`). No Electron import.

import { EventEmitter } from "node:events";
import type { SelfTestReport, SelfTestRequest } from "@shared/protocol";
import type { HelperSupervisor } from "./helper/supervisor";

export class SelfTestController extends EventEmitter<{ change: [{ running: boolean }] }> {
  private running = false;

  constructor(
    private readonly helper: Pick<HelperSupervisor, "request">,
    private readonly isRecording: () => boolean,
    private readonly log: (line: string) => void = () => {},
  ) {
    super();
  }

  get state(): { running: boolean } {
    return { running: this.running };
  }

  async run(request: SelfTestRequest = {}): Promise<SelfTestReport> {
    if (this.isRecording()) throw new Error("Talk is recording. Stop the recording, then test your microphone and system audio.");
    if (this.running) throw new Error("A microphone and system audio test is already running.");
    this.running = true;
    this.emit("change", this.state);
    try {
      const report = await this.helper.request("selftest.run", request);
      this.log(`self-test: ${report.passed ? "passed" : "not passed"} (mic ${report.mic.status}, system ${report.system.status}, voice processing ${report.voiceProcessing})`);
      return report;
    } finally {
      this.running = false;
      this.emit("change", this.state);
    }
  }
}
