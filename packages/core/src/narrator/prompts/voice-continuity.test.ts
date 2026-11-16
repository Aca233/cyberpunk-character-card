import { describe, expect, it } from "vitest";
import { newGameWorld } from "../../game";
import type { LogRecord } from "../../kernel/turnlog";
import { ItemDefSchema } from "../../systems/inventory/schema";
import { NpcSchema } from "../../systems/npc";
import { buildNarratorPrompt, NARRATE_STAGE, proseHabits } from "./narrate";

const texts = [
  "灯光一暗。她摆弄数据芯片，垂下眼帘。",
  "敲门声响。桌面摆着数据芯片，他垂下眼帘。",
  "远处传来车声。数据芯片已经插回读卡器，她又垂下眼帘。",
];

describe("正文维持人物口吻与物件身份", () => {
  it("反复谈论的稳定物件名不被列为必须换掉的修辞，重复动作仍能提醒", () => {
    const hint = proseHabits(texts, ["数据芯片"]);
    const repeats = hint?.split("\n").find((line) => line.startsWith("可能重复的修辞"));
    expect(repeats).toContain("垂下眼帘");
    expect(repeats).not.toContain("数据芯片");
    expect(hint).toContain("必要事实、玩家原话和人物惯用语照常保留");
  });

  it("真实正文提示词把物件名加入豁免，保留公司角色本来的完整句式", () => {
    const initial = newGameWorld({ startTime: 1000 });
    const npc = NpcSchema.parse({
      id: "liaison",
      name: "林澄",
      pronoun: "她",
      role: "公司顾问",
      look: "穿正装",
      voice: "语气克制，以完整句子说明条件，避免黑话",
      samples: ["我可以理解您的立场，但需要先确认授权。"],
      want: "确认授权",
      limit: "不泄露客户资料",
      affinity: 0,
      alive: true,
      met: true,
      location: "office",
      lastSeenAt: 1000,
      memories: [],
    });
    const world = { ...initial, slices: { ...initial.slices, npc: { npcs: { liaison: npc } } } };
    const records: LogRecord[] = texts.map((text, seq) => ({
      kind: "turn",
      seq,
      at: "2077-01-01T00:00:00Z",
      requestId: `voice-${seq}`,
      baseVersion: seq,
      input: { text: "继续谈芯片" },
      dice: [],
      commands: [],
      dropped: [],
      text,
      patches: [],
    }));
    const prompt = buildNarratorPrompt(
      world,
      records,
      { kind: "action", input: { text: "问她需要什么授权。" } },
      {
        data: {
          items: [
            ItemDefSchema.parse({
              id: "data-chip",
              name: "数据芯片",
              kind: "misc",
              price: 0,
              ability: "保存数据",
            }),
          ],
        },
      },
    );
    const content = prompt.messages.at(-1)?.content ?? "";
    expect(content).toContain(npc.voice);
    const repeats = content.split("\n").find((line) => line.startsWith("可能重复的修辞"));
    expect(repeats).toContain("垂下眼帘");
    expect(repeats).not.toContain("数据芯片");
    expect(NARRATE_STAGE).toContain("公司人员可以正式克制");
    expect(NARRATE_STAGE).not.toContain("把书面官腔彻底踢出去");
  });
});
