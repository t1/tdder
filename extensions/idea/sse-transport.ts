import { request, type ClientRequest, type IncomingMessage } from "node:http";
import { parseFrames } from "./sse-parser.ts";

export class SseTransport {
  private sessionUrl = "";
  onMessage: (data: string) => void = () => {};
  private req?: ClientRequest;
  private _res?: IncomingMessage;

  /** The active SSE response stream, or undefined before connect() or after close(). */
  get res(): IncomingMessage | undefined { return this._res; }

  constructor(private baseUrl: string) {}

  async connect(timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`SSE connect timed out after ${timeoutMs}ms — no endpoint event received`));
      }, timeoutMs);

      this.req = request(`${this.baseUrl}/sse`, { method: "GET" });
      this.req.on("error", (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
      this.req.on("response", (res: IncomingMessage) => {
        this._res = res;
        let buffer = "";
        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const { frames, remainder } = parseFrames(buffer);
          buffer = remainder;
          for (const frame of frames) {
            if (frame.event === "endpoint") {
              this.sessionUrl = frame.data;
              clearTimeout(timer);
              resolve();
            } else if (frame.event === "message") {
              this.onMessage(frame.data);
            }
          }
        });
      });
      this.req.end();
    });
  }

  async send(body: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = request(`${this.baseUrl}${this.sessionUrl}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body).toString(),
        },
      });
      req.on("error", reject);
      req.on("response", () => resolve());
      req.end(body);
    });
  }

  async close(): Promise<void> {
    this._res?.destroy();
    this.req?.destroy();
  }
}
