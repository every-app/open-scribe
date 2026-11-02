import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelfTest } from "./SelfTest";

afterEach(cleanup);

const ok = {
  status: "ok",
  peak: 0.5,
  clipping: false,
  clippedSamples: 0,
  dropouts: 0,
} as const;

describe("SelfTest", () => {
  it("runs, shows live meters and asks for sound while running", () => {
    const onRun = vi.fn();
    const { rerender } = render(
      <SelfTest
        state={{ kind: "idle" }}
        onRun={onRun}
        onOpenSettings={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(onRun).toHaveBeenCalledOnce();
    rerender(
      <SelfTest
        state={{ kind: "running", levels: { mic: 0.6, system: 0.3 } }}
        onRun={onRun}
        onOpenSettings={() => {}}
      />,
    );
    expect(screen.getByText("Talk to your Mac and play a video…")).toBeTruthy();
    expect(screen.getByText(/Mic level 60%/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /test/i })).toBeNull();
  });

  it("shows the results, with Open Settings for a denied side, and Test again", () => {
    const onOpenSettings = vi.fn();
    render(
      <SelfTest
        state={{
          kind: "done",
          report: {
            seconds: 8,
            passed: false,
            voiceProcessing: false,
            mic: ok,
            system: { ...ok, status: "denied" },
          },
        }}
        onRun={() => {}}
        onOpenSettings={onOpenSettings}
      />,
    );
    expect(screen.getByText("Your microphone works.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(onOpenSettings).toHaveBeenCalledWith("systemAudio");
    expect(screen.getByRole("button", { name: "Test again" })).toBeTruthy();
  });

  it("explains why it can't run, and shows a refusal", () => {
    const { rerender } = render(
      <SelfTest
        state={{ kind: "idle" }}
        disabledReason="Stop the recording to test your microphone and system audio."
        onRun={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    expect(
      (screen.getByRole("button", { name: "Run test" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText(/Stop the recording/)).toBeTruthy();
    rerender(
      <SelfTest
        state={{
          kind: "error",
          message: "A microphone and system audio test is already running.",
        }}
        onRun={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/already running/);
  });
});
