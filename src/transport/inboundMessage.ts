export interface TransportInboundAttachmentMetadata {
  kind: "audio" | "document" | "image" | "video";
  providerMediaId?: string | undefined;
  mimeType?: string | undefined;
  fileName?: string | undefined;
  sha256?: string | undefined;
}

export interface TransportInboundMessage {
  id: string;
  from: string;
  chatId: string;
  body: string;
  attachments?: TransportInboundAttachmentMetadata[];
  fromMe: boolean;
  timestamp: number;
  actor?: "client" | "lawyer";
  sender?: {
    pushname?: string;
  };
  transport?: "openwa" | "whatsapp_cloud";
}
