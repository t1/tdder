export class UnfoldingFatalError extends Error {
  readonly code: string;
  readonly causeDetail?: string;

  constructor(code: string, message: string, causeDetail?: string) {
    super(message);
    this.name = "UnfoldingFatalError";
    this.code = code;
    this.causeDetail = causeDetail;
  }
}

export function isUnfoldingFatalError(error: unknown): error is UnfoldingFatalError {
  return error instanceof UnfoldingFatalError;
}
