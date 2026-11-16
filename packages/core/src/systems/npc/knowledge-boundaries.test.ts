import { describe, expect, it } from "vitest";
import { cropNpcPersona, evaluatePhoneAvailability } from "../../npc";
import { castSection, npcRules } from "./prompt";
import { type Npc, NpcSchema } from "./schema";

function person(extra: Partial<Npc> = {}): Npc {
  return NpcSchema.parse({
    id: "liaison",
    name: "林澄",
    pronoun: "她",
    role: "公司公关顾问",
    look: "戴细框眼镜",
    voice: "完整的短句，礼貌而有距离",
    want: "替秘密雇主取得数据",
    limit: "不透露客户身份",
    secret: "客户是正在被公司调查的财务主管",
    affinity: 0,
    alive: true,
    met: true,
    location: "office",
    lastSeenAt: 1000,
    memories: [],
    ...extra,
  });
}

describe("NPC 信任、公开知识与幕后事实各自有边界", () => {
  it.each<Partial<Npc>>([
    { relation: { text: "一直互相提防的竞争对手", at: 1000 } },
    { ledger: [{ kind: "grudge", text: "玩家泄露过她的客户名单", at: 1000, settledAt: null }] },
    { ledger: [{ kind: "owesYou", text: "玩家救过她", at: 1000, settledAt: null }] },
    { known: [{ text: "植入了军用级义眼", source: "scan", at: 1000 }] },
    { known: [{ text: "穿着公司制服", source: "seen", at: 1000 }] },
  ])("关系或见闻不会把未揭露秘密放进公开人设：%j", (extra) => {
    const npc = person(extra);
    const publicCard = cropNpcPersona(npc);
    expect(publicCard.known).toEqual(npc.known);
    expect(JSON.stringify(publicCard)).not.toContain(npc.secret);
    expect(JSON.stringify(publicCard)).not.toContain(npc.want);
    const prompt = castSection(
      { npcs: { liaison: npc } },
      { location: "office", sceneStartedAt: 999 },
    );
    expect(prompt).toContain(`幕后秘密（不等于玩家或其他 NPC 已知）：${npc.secret}`);
    expect(prompt).not.toContain("已深交可触及");
    expect(prompt).toContain("扫描都不自动公开秘密");
  });

  it("获得局部传闻只公开该条及来源，既不揭开整份秘密，也不把传闻替换成真相", () => {
    const npc = person({
      known: [{ text: "街上传她的客户是外地商人", source: "rumor", at: 1000 }],
    });
    const card = cropNpcPersona(npc);
    expect(card.known).toEqual(npc.known);
    expect(card.known[0]?.source).toBe("rumor");
    expect(JSON.stringify(card)).not.toContain("财务主管");
  });

  it("熟人死亡在关系卡上是世界事实，不能自动当作这个人或玩家收到的消息", () => {
    const npc = person({ ties: [{ id: "courier", text: "一起长大的邻居", open: false, at: 900 }] });
    const courier = person({
      id: "courier",
      name: "送货员",
      alive: false,
      location: "docks",
      offscreenDeath: { cause: "码头事故", at: 1000 },
      known: [],
    });
    const prompt = castSection(
      { npcs: { liaison: npc, courier } },
      { location: "office", sceneStartedAt: 999 },
    );
    expect(prompt).toContain("幕后事实：已死；此人是否获知须看已有目击或消息来源");
    expect(prompt).toContain("暗地里");
    expect(prompt).toContain("玩家角色还不知道");
    expect(npcRules.narrate).toContain("没有来源就仍不知道");
    expect(npcRules.narrate).not.toContain("熟人出事他会知道");
  });

  it("扫描、敌对关系不会让非夜班职业半夜接电话，实际人情可构成例外但仍不公开秘密", () => {
    const casual = person({
      relation: { text: "互相提防", at: 1000 },
      known: [{ text: "戴军用义眼", source: "scan", at: 1000 }],
    });
    expect(evaluatePhoneAvailability(casual, 150).answered).toBe(false);
    const involved = person({
      ledger: [{ kind: "owesYou", text: "还欠玩家一次紧急援助", at: 1000, settledAt: null }],
    });
    expect(evaluatePhoneAvailability(involved, 150).answered).toBe(true);
    expect(cropNpcPersona(involved).known).toEqual([]);
    expect(
      evaluatePhoneAvailability(
        person({ ledger: [{ kind: "grudge", text: "被玩家出卖", at: 1000, settledAt: null }] }),
        720,
      ).answered,
    ).toBe(false);
  });
});
