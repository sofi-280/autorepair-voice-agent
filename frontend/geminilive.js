/**
 * GeminiLiveClient
 * ─────────────────
 * Handles the full Gemini Live API WebSocket lifecycle:
 *   1. Fetches a short-lived ephemeral token from /api/token
 *   2. Opens a direct WSS connection to generativelanguage.googleapis.com
 *   3. Sends setup (model, system prompt, tools, voice)
 *   4. Streams PCM audio in both directions
 *   5. Dispatches CustomEvents for audio, transcripts, tool calls, etc.
 *
 * Usage:
 *   const client = new GeminiLiveClient();
 *   client.addEventListener('audio',       e => playAudio(e.detail));
 *   client.addEventListener('toolCall',    e => handleTools(e.detail));
 *   client.addEventListener('inputTranscript',  e => showUserText(e.detail));
 *   client.addEventListener('outputTranscript', e => showAgentText(e.detail));
 *   client.addEventListener('turnComplete', () => resetPlayback());
 *   await client.connect({ systemPrompt, tools, voice });
 *   client.sendAudio(base64pcm16k);
 *   client.sendToolResponse([{ id, name, response }]);
 *   client.disconnect();
 */

const GEMINI_WS_BASE =
  "wss://generativelanguage.googleapis.com/ws/" +
  "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

class GeminiLiveClient extends EventTarget {
  constructor() {
    super();
    this._ws          = null;
    this._connected   = false;
    this._setupDone   = false;
  }

  get isConnected() { return this._connected; }

  // ── Public: connect ──────────────────────────────────────────
  async connect({ systemPrompt = "", tools = [], voice = "Puck" } = {}) {
    // 1. Get ephemeral token + model from backend
    const resp = await fetch("/api/token");
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`Token fetch failed: ${err.detail || resp.status}`);
    }
    const { token, model, shop_name } = await resp.json();

    // 2. Build system prompt (inject shop name if placeholder present)
    const finalPrompt = systemPrompt.replace(/\[Shop Name\]/g, shop_name || "our shop");

    // 3. Open WebSocket directly to Gemini
    const url = `${GEMINI_WS_BASE}?key=${token}`;
    this._ws = new WebSocket(url);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Connection timeout (10s)")), 10_000);

      this._ws.onopen = () => {
        // 4. Send session setup immediately
        this._send({
          setup: {
            model: `models/${model}`,
            generation_config: {
              response_modalities: ["AUDIO"],
              speech_config: {
                voice_config: {
                  prebuilt_voice_config: { voice_name: voice }
                }
              }
            },
            system_instruction: {
              parts: [{ text: finalPrompt }]
            },
            tools: tools.length ? [{ function_declarations: tools }] : [],
            input_audio_transcription:  {},
            output_audio_transcription: {},
            realtime_input_config: {
              automatic_activity_detection: {
                disabled: false,
                start_of_speech_sensitivity: "START_SENSITIVITY_HIGH",
                end_of_speech_sensitivity:   "END_SENSITIVITY_HIGH",
                silence_duration_ms:         600,
                prefix_padding_ms:           20
              }
            }
          }
        });
      };

      this._ws.onmessage = (evt) => {
        let msg;
        try { msg = JSON.parse(evt.data); } catch { return; }

        // ── Setup complete ──────────────────────────────────────
        if (msg.setupComplete) {
          clearTimeout(timeout);
          this._connected = true;
          this._setupDone = true;
          resolve();
          return;
        }

        // ── Server content (audio + transcripts + turn signals) ─
        const sc = msg.serverContent;
        if (sc) {
          const parts = sc.modelTurn?.parts ?? [];
          for (const p of parts) {
            if (p.inlineData?.data) {
              this._emit("audio", p.inlineData.data);
            }
            if (p.text) {
              this._emit("text", p.text);
            }
          }
          if (sc.inputTranscription?.text) {
            this._emit("inputTranscript",  sc.inputTranscription.text);
          }
          if (sc.outputTranscription?.text) {
            this._emit("outputTranscript", sc.outputTranscription.text);
          }
          if (sc.turnComplete)  this._emit("turnComplete");
          if (sc.interrupted)   this._emit("interrupted");
        }

        // ── Tool / function calls ───────────────────────────────
        if (msg.toolCall?.functionCalls?.length) {
          this._emit("toolCall", msg.toolCall.functionCalls);
        }

        // ── Usage metadata ──────────────────────────────────────
        if (msg.usageMetadata) {
          this._emit("usage", msg.usageMetadata);
        }
      };

      this._ws.onclose = (evt) => {
        clearTimeout(timeout);
        this._connected = false;
        this._emit("disconnected", { code: evt.code, reason: evt.reason });
        if (!this._setupDone) {
          reject(new Error(`WebSocket closed before setup: ${evt.code} ${evt.reason}`));
        }
      };

      this._ws.onerror = () => {
        clearTimeout(timeout);
        this._emit("error", "WebSocket error");
        if (!this._setupDone) {
          reject(new Error("WebSocket connection error — check API key and network"));
        }
      };
    });
  }

  // ── Public: sendAudio ────────────────────────────────────────
  /** base64 is raw 16-bit PCM at 16 kHz, little-endian */
  sendAudio(base64) {
    if (!this._connected) return;
    this._send({
      realtime_input: {
        media_chunks: [{ mime_type: "audio/pcm;rate=16000", data: base64 }]
      }
    });
  }

  // ── Public: sendText ─────────────────────────────────────────
  sendText(text) {
    if (!this._connected) return;
    this._send({
      client_content: {
        turns: [{ role: "user", parts: [{ text }] }],
        turn_complete: true
      }
    });
  }

  // ── Public: sendToolResponse ─────────────────────────────────
  /** responses = [{ id, name, response: {...} }] */
  sendToolResponse(responses) {
    if (!this._connected) return;
    this._send({
      tool_response: {
        function_responses: responses.map(r => ({
          id:       r.id,
          name:     r.name,
          response: r.response
        }))
      }
    });
  }

  // ── Public: disconnect ───────────────────────────────────────
  disconnect() {
    this._connected = false;
    this._ws?.close(1000, "User ended call");
    this._ws = null;
  }

  // ── Private ──────────────────────────────────────────────────
  _send(obj) {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(obj));
    }
  }

  _emit(eventName, detail) {
    this.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}
