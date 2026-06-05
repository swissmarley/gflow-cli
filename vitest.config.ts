import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Several suites drive a real (headless) browser with deliberate waits and
    // download events. The default 5s per-test timeout is too tight on slower CI
    // (Node 22 was timing out on the two-job fixture test), so raise it globally.
    // Fast unit tests are unaffected — this only changes the failure ceiling.
    testTimeout: 30000,
    hookTimeout: 30000
  }
});
