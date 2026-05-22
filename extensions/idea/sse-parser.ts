export interface Frame {
  event: string;
  data: string;
}

export interface ParseResult {
  frames: Frame[];
  remainder: string;
}

export function parseFrames(buffer: string): ParseResult {
  // SSE spec allows CRLF, LF, or CR as line endings. Normalize to LF up front
  // so the rest of the parser only has to think about one form. Real JetBrains
  // MCP uses CRLF; our unit-test fake server used LF.
  const normalized = buffer.replace(/\r\n?/g, "\n");
  const parts = normalized.split("\n\n");
  const remainder = parts.pop() ?? "";
  const frames = parts.filter((p) => p !== "").map(parseBlock);
  return { frames, remainder };
}

function parseBlock(block: string): Frame {
  const frame: Partial<Frame> = {};
  for (const line of block.split("\n")) {
    if (line.startsWith("event: ")) frame.event = line.slice("event: ".length);
    else if (line.startsWith("data: ")) frame.data = line.slice("data: ".length);
  }
  return { event: frame.event!, data: frame.data! };
}
