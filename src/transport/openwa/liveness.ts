import { STATE, type Client } from "@open-wa/wa-automate";
import type { OpenWaLivenessCheck, OpenWaLivenessCheckMeta } from "./types.ts";

type OpenWaReadOnlyClient = Pick<Client, "getConnectionState" | "isConnected">;

const hasGetConnectionState = (
  client: Partial<OpenWaReadOnlyClient>
): client is Pick<OpenWaReadOnlyClient, "getConnectionState"> =>
  typeof client.getConnectionState === "function";

const hasIsConnected = (
  client: Partial<OpenWaReadOnlyClient>
): client is Pick<OpenWaReadOnlyClient, "isConnected"> =>
  typeof client.isConnected === "function";

const toFailureReason = (connectionState: string): string =>
  `openwa_connection_state_${connectionState.toLowerCase()}`;

export const createNoopOpenWaLivenessCheck = (): OpenWaLivenessCheck => async () => ({
  mode: "noop"
});

export const createOpenWaLivenessCheck = (
  client: Partial<OpenWaReadOnlyClient>
): OpenWaLivenessCheck => {
  if (!hasGetConnectionState(client) && !hasIsConnected(client)) {
    return createNoopOpenWaLivenessCheck();
  }

  return async (): Promise<OpenWaLivenessCheckMeta> => {
    const meta: OpenWaLivenessCheckMeta = {
      mode: "read_only"
    };

    if (hasGetConnectionState(client)) {
      const connectionState = await client.getConnectionState();
      meta.connectionState = connectionState;

      if (connectionState !== STATE.CONNECTED) {
        throw new Error(toFailureReason(String(connectionState)));
      }
    }

    if (hasIsConnected(client)) {
      const connected = await client.isConnected();
      meta.connected = connected;

      if (!connected) {
        throw new Error("openwa_not_connected");
      }
    }

    return meta;
  };
};
