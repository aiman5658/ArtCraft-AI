# ArtCraft AI — Gemini Edition

A vanilla HTML/CSS/JavaScript + Node.js/Express + Supabase chatbot specialized in art and crafts, powered by Google's Gemini API.

## Features

- ChatGPT-style interface
- Gemini-powered art & craft assistant
- Streaming Gemini responses
- Persistent Supabase chat history
- New chat
- Delete chat
- Rename chat
- Search chat history
- Copy responses
- Regenerate responses
- Stop generation
- Browser speech-to-text
- Image attachment UI foundation
- Responsive mobile layout
- Server-side API key protection

## Setup

### 1. Install dependencies

From the project root:

```bash
npm install
```

### 2. Create your environment file

Copy `.env.example` to `.env` and add:

```env
PORT=3000
GEMINI_API_KEY=your_gemini_api_key
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

Never expose the Gemini API key or Supabase service-role key in frontend files.

### 3. Configure Supabase

Open the Supabase SQL Editor and run `supabase.sql`.

### 4. Start the app

```bash
npm start
```

Then open:

http://localhost:3000

For development:

```bash
npm run dev
```

## Gemini

The server uses the official `@google/genai` SDK and the `gemini-2.5-flash` model for chat streaming.

The frontend never receives the Gemini API key. Browser requests go to `/api/chat`, and the Node.js server calls Gemini.

## Important

If you run the server directly from the `server` folder:

```bash
cd server
node server.js
```

the server is already configured to load `.env` from the project root.

## Supabase security

This starter uses a server-side Supabase service-role key. Never expose it in browser JavaScript.

For public production use, add Supabase Auth and replace the anonymous browser-generated user ID with the authenticated user's ID. Add rate limiting and validate all inputs/uploads before public deployment.

## Image understanding

The attachment button is currently a UI foundation. It does not send image data to Gemini yet. To add Gemini vision/image understanding, extend `/api/chat` to accept validated image data and send Gemini image parts together with the user's text.
