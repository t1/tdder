import type { ExtensionAPI, ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { isUnfoldingFatalError, UnfoldingFatalError } from "./fatal-error.ts";

export interface AskSenseiParams {
  question: string;
  context?: string;
  options?: string[];
  placeholder?: string;
  role?: string;
}

export type AskSenseiFn = (params: AskSenseiParams) => Promise<string>;

type AskSenseiContext = Pick<ExtensionContext, "mode" | "ui">;

type RootUiCapture = Pick<ExtensionContext, "hasUI" | "mode"> & { ui: ExtensionUIContext };

export async function askSenseiViaUi(
  params: AskSenseiParams,
  ctx: AskSenseiContext,
): Promise<string> {
  const rolePrefix = params.role ? `[${params.role}]` : undefined;
  const contextParts = [rolePrefix, params.context].filter(Boolean);
  const prompt = contextParts.length > 0 ? `${contextParts.join(" ")}\n\n${params.question}` : params.question;
  const options = params.options?.filter(option => option.length > 0) ?? [];

  if (options.length === 0) {
    const answer = await ctx.ui.input(prompt, params.placeholder ?? "");
    if (answer === undefined) throw new UnfoldingFatalError("REQUEST_ABORTED", "request was aborted");
    return answer;
  }

  const proxiedChildUi = (ctx.ui as any)?.__unfoldingProxy === true;
  if (ctx.mode === "tui" && !proxiedChildUi) return askSenseiViaQuestionnaire(prompt, options, ctx);
  return askSenseiViaDialogs(prompt, options, ctx);
}

async function askSenseiViaDialogs(
  prompt: string,
  options: string[],
  ctx: AskSenseiContext,
): Promise<string> {
  const selected = await ctx.ui.select(prompt, options);
  if (selected === undefined) throw new UnfoldingFatalError("REQUEST_ABORTED", "request was aborted");

  const answer = await ctx.ui.editor(prompt, selected);
  if (answer === undefined) throw new UnfoldingFatalError("REQUEST_ABORTED", "request was aborted");
  return answer;
}

async function askSenseiViaQuestionnaire(
  prompt: string,
  options: string[],
  ctx: AskSenseiContext,
): Promise<string> {
  const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    let optionIndex = 0;
    let editMode = false;
    let cachedLines: string[] | undefined;

    const editorTheme: EditorTheme = {
      borderColor: (s) => theme.fg("accent", s),
      selectList: {
        selectedPrefix: (t) => theme.fg("accent", t),
        selectedText: (t) => theme.fg("accent", t),
        description: (t) => theme.fg("muted", t),
        scrollInfo: (t) => theme.fg("dim", t),
        noMatch: (t) => theme.fg("warning", t),
      },
    };
    const editor = new Editor(tui, editorTheme);

    editor.onSubmit = (value) => {
      done(value);
    };

    function refresh() {
      cachedLines = undefined;
      tui.requestRender();
    }

    function enterEditMode() {
      editMode = true;
      editor.setText(options[optionIndex] ?? "");
      refresh();
    }

    function handleInput(data: string) {
      if (editMode) {
        if (matchesKey(data, Key.escape)) {
          editMode = false;
          editor.setText("");
          refresh();
          return;
        }
        editor.handleInput(data);
        refresh();
        return;
      }

      if (matchesKey(data, Key.up)) {
        optionIndex = Math.max(0, optionIndex - 1);
        refresh();
        return;
      }
      if (matchesKey(data, Key.down)) {
        optionIndex = Math.min(options.length - 1, optionIndex + 1);
        refresh();
        return;
      }
      if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
        enterEditMode();
        return;
      }
      if (matchesKey(data, Key.enter)) {
        done(options[optionIndex] ?? "");
        return;
      }
      if (matchesKey(data, Key.escape)) done(null);
    }

    function render(width: number): string[] {
      if (cachedLines) return cachedLines;

      const lines: string[] = [];
      const renderWidth = Math.max(1, width);

      function addWrapped(text: string) {
        lines.push(...wrapTextWithAnsi(text, renderWidth));
      }

      function addWrappedWithPrefix(prefix: string, text: string) {
        const prefixWidth = visibleWidth(prefix);
        if (prefixWidth >= renderWidth) {
          addWrapped(prefix + text);
          return;
        }
        const wrapped = wrapTextWithAnsi(text, renderWidth - prefixWidth);
        const continuationPrefix = " ".repeat(prefixWidth);
        for (let i = 0; i < wrapped.length; i++) {
          lines.push(`${i === 0 ? prefix : continuationPrefix}${wrapped[i]}`);
        }
      }

      lines.push(theme.fg("accent", "─".repeat(renderWidth)));
      addWrappedWithPrefix(" ", theme.fg("text", prompt));
      lines.push("");

      for (let i = 0; i < options.length; i++) {
        const selected = i === optionIndex;
        const prefix = selected ? theme.fg("accent", "> ") : "  ";
        const color = selected ? "accent" : "text";
        addWrappedWithPrefix(prefix, theme.fg(color, `${i + 1}. ${options[i]}`));
      }

      lines.push("");
      if (editMode) {
        addWrappedWithPrefix(" ", theme.fg("muted", "Edit or replace the answer:"));
        for (const line of editor.render(Math.max(1, renderWidth - 2))) {
          lines.push(` ${line}`);
        }
        lines.push("");
        addWrappedWithPrefix(" ", theme.fg("dim", "Enter to submit • Esc to return to the options"));
      } else {
        addWrappedWithPrefix(" ", theme.fg("dim", "↑↓ navigate • Enter to accept • Tab/→ to edit or replace • Esc to abort"));
      }
      lines.push(theme.fg("accent", "─".repeat(renderWidth)));

      cachedLines = lines;
      return lines;
    }

    return {
      render,
      invalidate: () => {
        cachedLines = undefined;
      },
      handleInput,
    };
  });

  if (result === null) throw new UnfoldingFatalError("REQUEST_ABORTED", "request was aborted");
  return result;
}

export function createAskSenseiFn(ctx: Pick<ExtensionContext, "hasUI" | "mode" | "ui">): AskSenseiFn {
  return async (params: AskSenseiParams) => {
    if (!ctx.hasUI) {
      throw new UnfoldingFatalError(
        "ASK_SENSEI_UI_UNAVAILABLE",
        "ask_sensei failed: UI is not available in this session",
      );
    }
    try {
      return await askSenseiViaUi(params, ctx);
    } catch (error) {
      if (isUnfoldingFatalError(error)) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new UnfoldingFatalError(
        "ASK_SENSEI_UI_FAILED",
        `ask_sensei failed while interacting with the UI: ${detail}`,
        detail,
      );
    }
  };
}

export function captureRootUiContext(pi: ExtensionAPI, ctx: Pick<ExtensionContext, "hasUI" | "mode" | "ui">): void {
  const current = (pi as any).__unfoldingRootUi as RootUiCapture | undefined;
  if ((ctx.ui as any)?.__unfoldingProxy === true && current) return;
  if (!ctx.hasUI) return;
  (pi as any).__unfoldingRootUi = { hasUI: ctx.hasUI, mode: ctx.mode, ui: ctx.ui };
}

export function getCapturedRootUiContext(pi: ExtensionAPI): RootUiCapture | undefined {
  return (pi as any).__unfoldingRootUi as RootUiCapture | undefined;
}

export function refreshAskSenseiCallback(pi: ExtensionAPI, ctx: Pick<ExtensionContext, "hasUI" | "mode" | "ui">): void {
  captureRootUiContext(pi, ctx);
}
