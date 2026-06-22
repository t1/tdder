import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";

export interface AskSenseiParams {
  question: string;
  context?: string;
  options?: string[];
  freeText?: boolean;
  placeholder?: string;
}

export interface AskSenseiResult {
  answer: string | null;
  cancelled: boolean;
}

export type AskSenseiFn = (params: AskSenseiParams) => Promise<AskSenseiResult>;

export async function askSenseiViaUi(
  params: AskSenseiParams,
  ui: Pick<ExtensionUIContext, "select" | "input">,
): Promise<AskSenseiResult> {
  const prompt = params.context ? `${params.context}\n\n${params.question}` : params.question;
  const options = params.options?.filter(option => option.length > 0) ?? [];

  if (options.length === 0) {
    const answer = await ui.input(prompt, params.placeholder ?? "");
    return { answer: answer ?? null, cancelled: answer === undefined };
  }

  const otherOption = "Other…";
  const selectableOptions = params.freeText ? [...options, otherOption] : options;
  const selected = await ui.select(prompt, selectableOptions);
  if (selected === undefined) return { answer: null, cancelled: true };
  if (selected !== otherOption) return { answer: selected, cancelled: false };

  const answer = await ui.input(prompt, params.placeholder ?? "");
  return { answer: answer ?? null, cancelled: answer === undefined };
}

export function createAskSenseiFn(ctx: Pick<ExtensionContext, "hasUI" | "ui">): AskSenseiFn {
  return async (params: AskSenseiParams) => {
    if (!ctx.hasUI) return { answer: null, cancelled: true };
    return askSenseiViaUi(params, ctx.ui);
  };
}
