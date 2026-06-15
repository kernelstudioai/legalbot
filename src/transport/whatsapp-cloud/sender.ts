import type { OutputPlanType } from "../../contracts/index.ts";

const DEFAULT_GRAPH_API_BASE_URL = "https://graph.facebook.com";

export interface WhatsAppCloudHttpResponse {
  bodyText: string;
  status: number;
}

export interface WhatsAppCloudHttpClient {
  post(
    url: string,
    options: {
      body: string;
      headers: Record<string, string>;
    }
  ): Promise<WhatsAppCloudHttpResponse>;
}

export interface WhatsAppCloudSender {
  sendText(to: string, body: string): Promise<void>;
}

export interface WhatsAppCloudDispatchResult {
  delivered: boolean;
  messageCount: number;
  unsupportedCount: number;
}

export interface WhatsAppCloudDispatcher {
  dispatch(plan: OutputPlanType): Promise<WhatsAppCloudDispatchResult>;
}

export interface CreateWhatsAppCloudSenderOptions {
  accessToken: string;
  apiVersion: string;
  baseUrl?: string;
  httpClient?: WhatsAppCloudHttpClient;
  phoneNumberId: string;
}

export const buildWhatsAppCloudTextMessagePayload = ({
  body,
  to
}: {
  body: string;
  to: string;
}) => ({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to,
  type: "text",
  text: {
    body,
    preview_url: false
  }
});

const createFetchHttpClient = (): WhatsAppCloudHttpClient => ({
  async post(url, options) {
    const response = await fetch(url, {
      method: "POST",
      headers: options.headers,
      body: options.body
    });

    return {
      status: response.status,
      bodyText: await response.text()
    };
  }
});

export const createWhatsAppCloudSender = ({
  accessToken,
  apiVersion,
  baseUrl = DEFAULT_GRAPH_API_BASE_URL,
  httpClient = createFetchHttpClient(),
  phoneNumberId
}: CreateWhatsAppCloudSenderOptions): WhatsAppCloudSender => ({
  async sendText(to, body) {
    const payload = buildWhatsAppCloudTextMessagePayload({
      to,
      body
    });
    const response = await httpClient.post(
      `${baseUrl.replace(/\/+$/, "")}/${apiVersion}/${phoneNumberId}/messages`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `WhatsApp Cloud API request failed with status ${response.status}.`
      );
    }
  }
});

export const createWhatsAppCloudDispatcher = (
  sender: WhatsAppCloudSender
): WhatsAppCloudDispatcher => ({
  async dispatch(plan) {
    let messageCount = 0;
    let unsupportedCount = 0;

    for (const message of plan.messages as Array<{
      kind: string;
      to: string;
      body?: string;
    }>) {
      if (message.kind !== "text" || typeof message.body !== "string") {
        unsupportedCount += 1;
        continue;
      }

      await sender.sendText(message.to, message.body);
      messageCount += 1;
    }

    return {
      delivered: messageCount > 0,
      messageCount,
      unsupportedCount
    };
  }
});
