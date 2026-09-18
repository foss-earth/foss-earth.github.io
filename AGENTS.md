# Agent Instructions

## Scratch files and working directories

- Never write outside this repository. No `/tmp`, no `/private/tmp`, no
  `/var/folders`, no harness-provided "scratchpad" directory. macOS empties
  `/private/tmp` on every restart.
- Scratch that must not be committed goes in the gitignored `build/` tree:
  `build/benchmarks/<area>/` for benchmark output that is not a tracked
  `results*.json`, and `build/tools/` for tools that are not dependencies, such
  as Playwright in `build/tools/playwright/`.

## Testing and computer use

- Prefer terminal commands, scripts, APIs, and headless browser automation for tests and benchmarks, including CPU/GPU comparisons.
- Do not take over the user's cursor or use a visible Chrome/browser GUI when a terminal or headless route can perform the task.
- Use GUI automation only when it is the only viable way to verify the required behavior; explain that necessity before using it.
- For GPU benchmarks, verify that the terminal/headless runtime uses the real hardware GPU rather than a software fallback.
