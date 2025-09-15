export enum Sender {
  User = 'user',
  AI = 'ai',
  System = 'system',
  Webex = 'webex',
}

export interface ChatMessage {
  id: string;
  sender: Sender;
  text: string;
  timestamp: string;
  // Scoping for DB
  userId?: number;
  networkId?: number;
}

export interface MerakiDevice {
  serial: string;
  name: string;
  model: string;
  networkId: string;
}

export interface User {
    id: number;
    username: string;
}

export interface NetworkConfiguration {
    id?: number; // Optional because it's set by the DB on creation
    userId: number;
    name: string;
    apiKey: string;
    orgId: string;
    webexWebhookUrl?: string;
    teamsWebhookUrl?: string;
    webexBotToken?: string;
    webexSpaceId?: string;
}

// --- WebSocket Message Types ---

export interface WsUserMessage {
    type: 'userMessage';
    payload: {
        text: string;
        chatHistory: ChatMessage[];
        devices: MerakiDevice[];
        networkConfig: NetworkConfiguration;
    };
}

export interface WsSystemMessage {
    type: 'systemMessage';
    payload: {
        text: string;
    };
}

export type WsMessage = WsUserMessage | WsSystemMessage;
