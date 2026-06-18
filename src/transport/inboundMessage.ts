export interface TransportInboundMessage {
  id: string;
  from: string;
  chatId: string;
  body: string;
  fromMe: boolean;
  timestamp: number;
  actor?: "client" | "lawyer";
  sender?: {
    pushname?: string;
  };
  transport?: "openwa" | "whatsapp_cloud";
}
