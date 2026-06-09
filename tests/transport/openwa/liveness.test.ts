import { describe, expect, it, vi } from "vitest";
import {
  createNoopOpenWaLivenessCheck,
  createOpenWaLivenessCheck
} from "../../../src/transport/openwa/liveness";

describe("openwa liveness check", () => {
  it("uses read-only client calls when available", async () => {
    const getConnectionState = vi.fn().mockResolvedValue("CONNECTED");
    const isConnected = vi.fn().mockResolvedValue(true);
    const checkLiveness = createOpenWaLivenessCheck({
      getConnectionState,
      isConnected
    });

    await expect(checkLiveness()).resolves.toEqual({
      mode: "read_only",
      connectionState: "CONNECTED",
      connected: true
    });
    expect(getConnectionState).toHaveBeenCalledTimes(1);
    expect(isConnected).toHaveBeenCalledTimes(1);
  });

  it("fails when the connection state is not connected", async () => {
    const checkLiveness = createOpenWaLivenessCheck({
      getConnectionState: vi.fn().mockResolvedValue("TIMEOUT")
    });

    await expect(checkLiveness()).rejects.toThrow("openwa_connection_state_timeout");
  });

  it("treats malformed OpenWA liveness responses as sanitized warnings", async () => {
    const checkLiveness = createOpenWaLivenessCheck({
      getConnectionState: vi
        .fn()
        .mockRejectedValue(new Error("Cannot read properties of undefined (reading 'default')")),
      isConnected: vi.fn().mockResolvedValue(true)
    });

    await expect(checkLiveness()).resolves.toEqual({
      mode: "read_only",
      connected: true,
      warningCode: "openwa_liveness_malformed_response",
      warningMessage: "OpenWA returned an unexpected liveness response shape"
    });
  });

  it("falls back to a noop heartbeat when no safe read-only calls are available", async () => {
    const checkLiveness = createNoopOpenWaLivenessCheck();

    await expect(checkLiveness()).resolves.toEqual({
      mode: "noop"
    });
  });
});
