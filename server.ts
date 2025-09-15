import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import cors from 'cors';
import { GoogleGenAI, GenerateContentResponse, Content, Part } from '@google/genai';
import { ChatMessage, MerakiDevice, NetworkConfiguration, Sender, WsUserMessage } from 'types';

dotenv.config();

const app = express();
// Fix: Swapped the order of middleware. This can sometimes resolve type inference issues in Express.
app.use(express.json());
// Enable CORS for all routes
app.use(cors());
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error("API_KEY environment variable not set.");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

// --- WebSocket Server Logic ---

wss.on('connection', (ws: WebSocket) => {
  console.log('Client connected to WebSocket');

  ws.on('message', async (message: string) => {
    try {
      const parsedMessage: WsUserMessage = JSON.parse(message);

      if (parsedMessage.type === 'userMessage') {
        const { text, chatHistory, devices, networkConfig } = parsedMessage.payload;
        console.log('Received message from client:', text);
        
        // Let client know AI is working
        ws.send(JSON.stringify({ sender: Sender.System, text: 'AI_THINKING' }));

        const aiResponseText = await getAiResponse(chatHistory, devices, networkConfig);
        
        const aiMessage: ChatMessage = {
            id: `ai-${Date.now()}`,
            sender: Sender.AI,
            text: aiResponseText,
            timestamp: new Date().toLocaleTimeString(),
            userId: networkConfig.userId,
            networkId: networkConfig.id
        };
        
        // Send AI response back to the client
        ws.send(JSON.stringify(aiMessage));

        // Also send AI response to Webex if configured
        if (networkConfig.webexBotToken && networkConfig.webexSpaceId) {
            // Don't send actions to Webex, only text responses
            const actionRegex = /<execute_action>([\s\S]*?)<\/execute_action>/;
            if (!aiResponseText.match(actionRegex)) {
                await sendWebexMessage(networkConfig.webexBotToken, networkConfig.webexSpaceId, aiResponseText);
            }
        }

        // Handle backend-executed actions (e.g., notifications)
        await handleBackendActions(aiResponseText, networkConfig, ws);
      }
    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({ 
          sender: Sender.System, 
          text: 'An error occurred on the server.' 
      }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// --- Webex Webhook Endpoint ---

app.post('/webex-webhook', (req, res) => {
  const { data, text } = req.body; // Vercel might send text directly

  // Basic validation and ignore messages from the bot itself to prevent loops
  if (data && data.personEmail && !data.personEmail.endsWith('@webex.bot')) {
    console.log(`Received message from Webex user: ${data.personEmail}`);

    // Broadcast the message to all connected WebSocket clients
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        // Attempt to find the message text from common webhook payload structures
        const messageText = req.body.text || (data.text) || 'New message from Webex';

        const webexMessage: ChatMessage = {
            id: data.id || `webex-${Date.now()}`,
            sender: Sender.Webex,
            text: messageText,
            timestamp: new Date(data.created).toLocaleTimeString(),
        };
        client.send(JSON.stringify(webexMessage));
      }
    });
  }

  res.sendStatus(200);
});


// --- Helper Functions ---

const getSystemInstruction = (devices: MerakiDevice[], networkConfig: NetworkConfiguration): string => {
  const deviceContext = JSON.stringify(devices.map(({ serial, name, model }) => ({ serial, name, model })), null, 2);
  const deviceList = devices.length > 0
    ? `Here is the list of Meraki devices discovered: ${deviceContext}`
    : "No Meraki devices have been loaded.";

  const notificationCapabilities = [];
  if (networkConfig.webexWebhookUrl) notificationCapabilities.push("Webex");
  if (networkConfig.teamsWebhookUrl) notificationCapabilities.push("Microsoft Teams");
  
  const notificationInfo = notificationCapabilities.length > 0
    ? `You can send notifications to: ${notificationCapabilities.join(', ')}.`
    : "Notification capabilities are not configured.";

  return `You are NetOps AI. Your primary goal is to help users manage their Meraki network devices.
${deviceList}
${notificationInfo}

When a user wants to perform an action, guide them to provide all necessary information.

**ACTION: Update Switch Port (Handled by Frontend)**
If the user confirms, respond with a JSON object in <execute_action> tags. The frontend will execute this.
Example: <execute_action>{"action": "update_switch_port", "payload": { "serial": "SERIAL", "portId": "ID", "type": "access", "vlan": 100 }}</execute_action>

**ACTION: Send Notification (Handled by Backend)**
If the user confirms, respond with a JSON object in <execute_action> tags. The backend will execute this.
Example: <execute_action>{"action": "send_notification", "payload": { "platform": "webex", "message": "This is a test." }}</execute_action>

Summarize the action and ask for confirmation before generating the <execute_action> tag. Do not add any other text with the action tag.`;
};

const formatHistory = (history: ChatMessage[]): Content[] => {
    return history.filter(m => !m.id.startsWith('ai-intro-') && m.sender !== Sender.System && m.sender !== Sender.Webex).map(message => ({
        role: message.sender === Sender.User ? 'user' : 'model',
        parts: [{ text: message.text }] as Part[],
    }));
};

const getAiResponse = async (chatHistory: ChatMessage[], devices: MerakiDevice[], networkConfig: NetworkConfiguration): Promise<string> => {
    const systemInstruction = getSystemInstruction(devices, networkConfig);
    const historyForApi = formatHistory(chatHistory.slice(0, -1));
    const lastMessage = chatHistory[chatHistory.length - 1];
    
    const contents: Content[] = [...historyForApi, { role: 'user', parts: [{ text: lastMessage.text }] }];

    try {
        const response: GenerateContentResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents,
            config: { systemInstruction }
        });
        return response.text;
    } catch (error) {
        console.error("Gemini API error:", error);
        return "There was an issue communicating with the AI. Please try again.";
    }
};

const sendWebexMessage = async (botToken: string, spaceId: string, message: string): Promise<void> => {
    try {
        const response = await fetch('https://webexapis.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${botToken}`,
            },
            body: JSON.stringify({ roomId: spaceId, markdown: message }),
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(`Webex API Error: ${JSON.stringify(err)}`);
        }
        console.log('Message sent successfully to Webex.');
    } catch (error) {
        console.error('Failed to send message to Webex:', error);
    }
};

const sendNotification = async (platform: 'webex' | 'teams', webhookUrl: string, message: string): Promise<void> => {
    const body = platform === 'webex' ? { markdown: message } : { text: message };
    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to send notification to ${platform}. Status: ${response.status}. Details: ${errorText}`);
    }
};

const handleBackendActions = async (aiText: string, networkConfig: NetworkConfiguration, ws: WebSocket) => {
    const actionRegex = /<execute_action>([\s\S]*?)<\/execute_action>/;
    const match = aiText.match(actionRegex);

    if (match && match[1]) {
        try {
            const actionJson = JSON.parse(match[1]);
            if (actionJson.action === 'send_notification') {
                const { platform, message } = actionJson.payload;
                const platformName = platform === 'webex' ? 'Webex' : 'Microsoft Teams';
                const webhookUrl = platform === 'webex' ? networkConfig.webexWebhookUrl : networkConfig.teamsWebhookUrl;

                if (!webhookUrl) {
                    ws.send(JSON.stringify({ sender: Sender.System, text: `❌ Error! No webhook URL is configured for ${platformName}.`}));
                    return;
                }
                
                await sendNotification(platform, webhookUrl, message);
                ws.send(JSON.stringify({ sender: Sender.System, text: `✅ Success! Notification sent to ${platformName}.`}));
            }
        } catch (e) {
            const error = e instanceof Error ? e.message : 'Unknown error';
            ws.send(JSON.stringify({ sender: Sender.System, text: `Failed to execute backend action: ${error}`}));
        }
    }
};


server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
