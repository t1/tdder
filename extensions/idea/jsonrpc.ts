export function serializeRequest(
  method: string,
  params: unknown,
  id: number,
): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

export interface ResponseMessage {
  kind: "response";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface NotificationMessage {
  kind: "notification";
  method: string;
  params: unknown;
}

export type Message = ResponseMessage | NotificationMessage;

export function parseMessage(text: string): Message {
  const raw = JSON.parse(text) as {
    id?: number;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: { code: number; message: string };
  };
  if (raw.id === undefined) {
    return { kind: "notification", method: raw.method!, params: raw.params };
  }
  const msg: ResponseMessage = { kind: "response", id: raw.id };
  if (raw.result !== undefined) msg.result = raw.result;
  if (raw.error !== undefined) msg.error = raw.error;
  return msg;
}
