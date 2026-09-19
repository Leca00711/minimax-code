import { describe, expect, it } from "vitest";

import { resolveMinRenderIntervalMs } from "../../src/tui/engine/tui.js";
import { detectTerminalCapabilities } from "../../src/tui/platform/terminal-capabilities.js";

function capabilities(env: Record<string, string>) {
  return detectTerminalCapabilities({ platform: "darwin", isTTY: true, env });
}

describe("terminal synchronized-output capability", () => {
  it("marks Apple Terminal as unsupported and modern terminals as supported", () => {
    expect(capabilities({ TERM_PROGRAM: "Apple_Terminal" }).supportsSynchronizedOutput).toBe(false);
    for (const program of ["iTerm.app", "ghostty", "WezTerm", "vscode"]) {
      expect(capabilities({ TERM_PROGRAM: program }).supportsSynchronizedOutput).toBe(true);
    }
    expect(capabilities({ KITTY_WINDOW_ID: "1" }).supportsSynchronizedOutput).toBe(true);
  });

  it("keeps the previous behavior for unknown terminals", () => {
    expect(capabilities({}).supportsSynchronizedOutput).toBe(true);
  });
});

describe("render frame budget", () => {
  it("coalesces frames on Apple Terminal, where DEC 2026 is ignored", () => {
    expect(resolveMinRenderIntervalMs({ TERM_PROGRAM: "Apple_Terminal" }, "darwin")).toBe(50);
  });

  it("keeps the 60 fps budget for terminals with synchronized output", () => {
    expect(resolveMinRenderIntervalMs({ TERM_PROGRAM: "iTerm.app" }, "darwin")).toBe(16);
    expect(resolveMinRenderIntervalMs({ TERM_PROGRAM: "ghostty" }, "darwin")).toBe(16);
    expect(resolveMinRenderIntervalMs({ TERM_PROGRAM: "WezTerm" }, "darwin")).toBe(16);
    expect(resolveMinRenderIntervalMs({}, "darwin")).toBe(16);
  });

  it("only applies the Apple Terminal rule on macOS", () => {
    expect(resolveMinRenderIntervalMs({ TERM_PROGRAM: "Apple_Terminal" }, "linux")).toBe(16);
    expect(resolveMinRenderIntervalMs({ TERM_PROGRAM: "Apple_Terminal" }, "win32")).toBe(16);
  });
});
