# NetOps AI Assistant - Backend Server

This directory contains the Node.js backend server for the NetOps AI Assistant. This server is required for the application to function.

## Features

-   **WebSocket Server**: Provides real-time, bi-directional communication with the frontend client.
-   **Gemini AI Integration**: Securely handles all communication with the Google Gemini API.
-   **Webex Integration**: 
    -   Receives incoming messages from a Webex space via a webhook.
    -   Sends AI responses back to the Webex space.
    -   Handles sending one-way notifications.

## Prerequisites

-   [Node.js](https://nodejs.org/) (v18 or later recommended)
-   [npm](https://www.npmjs.com/) (usually included with Node.js)

## 1. Installation

Navigate to this `backend` directory and install the required dependencies:

```bash
cd backend
npm install
```

## 2. Configuration

The server is configured using environment variables. Create a file named `.env` in this directory by copying the example file:

```bash
cp .env.sample .env
```

Now, open the `.env` file and fill in the required values:

-   `PORT`: The port the server will run on. Defaults to `3001`.
-   `API_KEY`: Your Google AI API key for Gemini.

**Optional Webex Integration:**

To enable the full bi-directional chat and notification features, you need to provide your Webex bot and webhook details.

-   `WEBEX_BOT_TOKEN`: The access token for your Webex bot.
-   `WEBEX_SPACE_ID`: The ID of the Webex space (room) you want the bot to interact with.
-   `WEBEX_WEBHOOK_URL`: The incoming webhook URL for sending simple notifications.

**Note:** The frontend application also needs to be configured with these Webex details in the Settings modal for the AI to be aware of them. The backend uses the configuration sent from the client with each message.

## 3. Running the Server

You can run the server in two modes:

### Development Mode

This mode uses `nodemon` and `ts-node` to automatically restart the server when you make changes to the source code.

```bash
npm run dev
```

### Production Mode

This command compiles the TypeScript to JavaScript (you may need to add a build step) and runs the server.

```bash
npm start
```

Once running, you should see the following message in your console:

```
Server is running on http://localhost:3001
```

The frontend application, running on its own server, will now be able to connect to this backend.
