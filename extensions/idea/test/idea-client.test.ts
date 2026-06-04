import { describe, it } from "vitest";
import { expect } from "vitest";
import { callIdeaTool } from "../idea-client.ts";

describe("callIdeaTool", () => {
  it("classifies a project-not-open error response correctly", async () => {
    const notOpenText =
      "`projectPath`=`/bad` doesn't correspond to any open project." +
      ' Currently open projects: {"projects":[{"path":"/real/project"}]}';
    const fakeClient = {
      callTool: async () => ({
        isError: true,
        content: [{ type: "text", text: notOpenText }],
      }),
    };
    const result = await callIdeaTool(fakeClient as never, "some_tool", {}, "/bad");
    expect(result.kind).toBe("project-not-open");
    expect((result as { kind: "project-not-open"; openProjects: string[] }).openProjects)
      .toEqual(["/real/project"]);
  });

  it("classifies a successful response as { kind: 'ok' }", async () => {
    const fakeClient = {
      callTool: async () => ({ isError: false, content: [{ type: "text", text: "hello" }] }),
    };
    const result = await callIdeaTool(fakeClient as never, "some_tool", {}, "/project");
    expect(result.kind).toBe("ok");
  });
});
