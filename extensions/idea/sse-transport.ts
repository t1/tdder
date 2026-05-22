import { request, type ClientRequest, type IncomingMessage } from "node:http";
import { parseFrames } from "./sse-parser.ts";

export class SseTransport {
  sessionUrl = "";
  onMessage: (data: string) => void = () => {};
  private req?: ClientRequest;

  constructor(private baseUrl: string) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.req = request(`${this.baseUrl}/sse`, { method: "GET" });
      this.req.on("error", reject);
      this.req.on("response", (res: IncomingMessage) => {
        let buffer = "";
        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const { frames, remainder } = parseFrames(buffer);
          buffer = remainder;
          for (const frame of frames) {
            if (frame.event === "endpoint") {
              this.sessionUrl = frame.data;
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
    this.req?.destroy();
  }
}
