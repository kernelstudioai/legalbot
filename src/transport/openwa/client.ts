export interface OpenWaClient {
  sendText(to: string, body: string): Promise<unknown>;
}

export interface OpenWaConfig {
  sessionId: string;
  headless: boolean;
}

export const createOpenWaConfig = (sessionName: string): OpenWaConfig => ({
  sessionId: sessionName,
  headless: true
});
