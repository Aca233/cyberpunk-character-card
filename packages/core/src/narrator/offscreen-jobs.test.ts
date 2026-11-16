import { describe, expect, it } from "vitest";
import { seededRng } from "../kernel/rng";
import type { Command } from "../kernel/system";
import type { WorldState } from "../kernel/world";
import { JobsStateSchema } from "../systems/jobs";
import { PhoneStateSchema } from "../systems/phone";
import { registry } from "../systems/registry";
import { OFFERED_CAP, offscreenFixers, readOffscreen } from "./offscreen";

// 场外推演里中间人主动派单（用户定的，2026-10-30："能不能接到世界演变里"）
const T0 = 60 * 24 * 10;
const ctx = { rng: seededRng(1) };

function apply(world: WorldState, commands: Command[]) {
  return registry.applyCommands(world, commands, ctx);
}

function start(): WorldState {
  const world = registry.initialWorld(T0);
  return apply(world, [
    { type: "jobs.seedFixer", id: "regina", name: "瑞吉娜·琼斯" },
    { type: "jobs.seedFixer", id: "wakako", name: "冈田和歌子" },
  ]).world;
}

const job = (over: Record<string, unknown> = {}) => ({
  id: "scav-den",
  title: "端掉拾荒者的窝",
  fixer: "regina",
  client: "身份不明",
  risk: 2,
  reward: 2000,
  conflict: "拾荒者在拆活人的义体，邻居想让他们消失",
  ...over,
});

const reply = (value: Record<string, unknown>) =>
  JSON.stringify({ events: [], npcs: [], messages: [], jobs: [], ...value });

describe("场外推演派单", () => {
  it("列出登记过的中间人，不附带声望星级门槛", () => {
    const fixers = offscreenFixers(start());
    expect(fixers.map((f) => f.id).sort()).toEqual(["regina", "wakako"]);
    expect(fixers.every((f) => !("max" in f))).toBe(true);
  });

  it("新委托排在带它的派单消息前面，结算后委托挂出、消息带着这一单", () => {
    const world = start();
    const got = readOffscreen(
      reply({
        jobs: [job()],
        messages: [{ from: "regina", text: "有活，过来聊。", job: "scav-den" }],
      }),
      world,
    );
    const types = got.commands.map((c) => c.type);
    expect(types.indexOf("jobOffer")).toBeGreaterThanOrEqual(0);
    expect(types.indexOf("jobOffer")).toBeLessThan(types.indexOf("phone.receive"));
    const after = apply(world, got.commands);
    expect(after.results.map((r) => r.result.ok)).toEqual(after.results.map(() => true));
    const jobs = JobsStateSchema.parse(after.world.slices.jobs).jobs;
    expect(jobs.find((j) => j.id === "scav-den")?.status).toBe("offered");
    const messages = PhoneStateSchema.parse(after.world.slices.phone).messages;
    expect(messages.some((m) => m.job === "scav-den")).toBe(true);
  });

  // 「全改」第 2 步（用户 2026-11-01：模型当主持人，代码只管记账）：没消息的单补消息，星级超了压到上限，条数是软上限
  it("中间人的单没有派单消息：代码补一条，单照挂", () => {
    const world = start();
    const got = readOffscreen(reply({ jobs: [job()] }), world);
    expect(got.commands.some((c) => c.type === "jobOffer")).toBe(true);
    const message = got.commands.find((c) => c.type === "phone.receive");
    expect(message?.from).toBe("regina");
    expect(message?.job).toBe("scav-den");
    expect(got.notes.some((n) => n.includes("代码补了一条"))).toBe(true);
    const after = apply(world, got.commands);
    expect(after.results.map((r) => r.result.ok)).toEqual(after.results.map(() => true));
  });

  it("别的中间人发消息带这一单：他的消息去掉委托，派单的中间人由代码补一条", () => {
    const got = readOffscreen(
      reply({
        jobs: [job()],
        messages: [{ from: "wakako", text: "听说你缺钱。", job: "scav-den" }],
      }),
      start(),
    );
    expect(got.commands.some((c) => c.type === "jobOffer")).toBe(true);
    const messages = got.commands.filter((c) => c.type === "phone.receive");
    expect(messages.find((m) => m.from === "wakako")?.job).toBeUndefined();
    expect(messages.find((m) => m.from === "regina")?.job).toBe("scav-den");
  });

  it("风险按实际事件保留，没登记的中间人不要", () => {
    const got = readOffscreen(
      reply({
        jobs: [job({ risk: 3 }), job({ id: "ghost-job", fixer: "nobody" })],
        messages: [{ from: "regina", text: "有活。", job: "scav-den" }],
      }),
      start(),
    );
    const offers = got.commands.filter((c) => c.type === "jobOffer");
    expect(offers.map((c) => [c.id, c.risk])).toEqual([["scav-den", 3]]);
    expect(got.notes.some((n) => n.includes("压到"))).toBe(false);
    expect(got.notes.some((n) => n.includes("不在【能派单的中间人】里"))).toBe(true);
  });

  it("一次多派的照收到软上限；补的消息也占这一轮的消息额度", () => {
    const got = readOffscreen(
      reply({
        jobs: [job({ id: "a" }), job({ id: "b" }), job({ id: "c" }), job({ id: "d" })],
        messages: [
          { from: "regina", text: "a", job: "a" },
          { from: "regina", text: "b", job: "b" },
        ],
      }),
      start(),
    );
    const offers = got.commands.filter((c) => c.type === "jobOffer");
    expect(offers.map((c) => c.id)).toEqual(["a", "b"]);
    expect(got.notes.some((n) => n.includes("后面的不收"))).toBe(true);
    expect(got.notes.some((n) => n.includes("消息也满了"))).toBe(true);
  });

  it(`挂着没接的委托到 ${OFFERED_CAP} 单就不再派`, () => {
    let world = start();
    for (let i = 0; i < OFFERED_CAP; i += 1) {
      world = apply(world, [{ type: "jobOffer", ...job({ id: `old-${i}` }) }]).world;
    }
    expect(JobsStateSchema.parse(world.slices.jobs).jobs).toHaveLength(OFFERED_CAP);
    expect(offscreenFixers(world)).toEqual([]);
    const got = readOffscreen(
      reply({
        jobs: [job()],
        messages: [{ from: "regina", text: "有活。", job: "scav-den" }],
      }),
      world,
    );
    expect(got.commands.some((c) => c.type === "jobOffer")).toBe(false);
  });
});

// 熟人求助（用户定的，2026-10-30："npc发消息也接入"）
describe("场外推演熟人求助", () => {
  function withFriend(affinity = 65): WorldState {
    return apply(start(), [
      {
        type: "npc.seed",
        id: "misty",
        name: "米丝蒂",
        pronoun: "她",
        role: "塔罗占卜师",
        look: "黑发，戴着很多手链",
        voice: "说话慢，爱打比方",
        want: "守住自己的小店",
        limit: "不出卖朋友",
        affinity,
        met: true,
      },
    ]).world;
  }
  const ask = (over: Record<string, unknown> = {}) =>
    job({
      id: "misty-shop",
      title: "帮米丝蒂赶走收保护费的",
      fixer: undefined,
      client: "米丝蒂",
      ...over,
    });

  it("被挑出来联系玩家的熟人发消息求助：委托挂出，没有中间人", () => {
    const world = withFriend();
    const got = readOffscreen(
      reply({
        jobs: [ask()],
        messages: [{ from: "misty", text: "能来店里一趟吗？有人找麻烦。", job: "misty-shop" }],
      }),
      world,
    );
    expect(got.commands.some((c) => c.type === "jobOffer")).toBe(true);
    const after = apply(world, got.commands);
    expect(after.results.map((r) => r.result.ok)).toEqual(after.results.map(() => true));
    const saved = JobsStateSchema.parse(after.world.slices.jobs).jobs.find(
      (j) => j.id === "misty-shop",
    );
    expect(saved?.status).toBe("offered");
    expect(saved?.fixer).toBeNull();
  });

  // 托的事不一定是真心的（用户定的，2026-10-30："不一定是真的求助信息啊"）：
  // 标题、委托人照他对玩家说的写，真相写在 twist 里，只给模型看
  it("别有用心的托事：照他说的挂出，真相存在 twist 里", () => {
    const world = withFriend();
    const twist = "根本没人收保护费，米丝蒂想把玩家引到店里，让漩涡帮的人等着";
    const got = readOffscreen(
      reply({
        jobs: [ask({ twist })],
        messages: [{ from: "misty", text: "能来店里一趟吗？有人找麻烦。", job: "misty-shop" }],
      }),
      world,
    );
    const after = apply(world, got.commands);
    expect(after.results.map((r) => r.result.ok)).toEqual(after.results.map(() => true));
    const saved = JobsStateSchema.parse(after.world.slices.jobs).jobs.find(
      (j) => j.id === "misty-shop",
    );
    expect(saved?.status).toBe("offered");
    expect(saved?.title).toBe("帮米丝蒂赶走收保护费的");
    expect(saved?.client).toBe("米丝蒂");
    expect(saved?.twist).toBe(twist);
  });

  // 熟人发消息也可以只是闲聊（用户定的，2026-10-30："也有可能是闲聊啊"）
  it("熟人只是闲聊：消息照发、不带委托，也不挂新单", () => {
    const world = withFriend();
    const got = readOffscreen(
      reply({
        messages: [{ from: "misty", text: "今晚的牌又抽到了塔，你那边没出事吧？" }],
      }),
      world,
    );
    expect(got.commands.some((c) => c.type === "jobOffer")).toBe(false);
    const sent = got.commands.filter((c) => c.type === "phone.receive");
    expect(sent).toEqual([
      { type: "phone.receive", from: "misty", text: "今晚的牌又抽到了塔，你那边没出事吧？" },
    ]);
    const after = apply(world, got.commands);
    expect(after.results.map((r) => r.result.ok)).toEqual(after.results.map(() => true));
  });

  // 「全改」第 2 步（用户 2026-11-01）：求助星级超了压到他的上限，不整单作废
  it("熟人求助按实际风险登记，不按好感压低分量", () => {
    const world = withFriend();
    const got = readOffscreen(
      reply({
        jobs: [ask({ risk: 3 })],
        messages: [{ from: "misty", text: "出事了。", job: "misty-shop" }],
      }),
      world,
    );
    expect(got.commands.find((c) => c.type === "jobOffer")?.risk).toBe(3);
    expect(got.commands.find((c) => c.type === "phone.receive")?.job).toBe("misty-shop");
    const after = apply(world, got.commands);
    expect(after.results.map((r) => r.result.ok)).toEqual(after.results.map(() => true));
    expect(got.notes.some((n) => n.includes("risk 2"))).toBe(false);
  });

  it("求助的单由中间人带不要；好感低的熟人也能发", () => {
    const byFixer = readOffscreen(
      reply({
        jobs: [ask()],
        messages: [{ from: "regina", text: "米丝蒂托我问你。", job: "misty-shop" }],
      }),
      withFriend(),
    );
    expect(byFixer.commands.some((c) => c.type === "jobOffer")).toBe(false);
    // 好感 10：谁来联系玩家由模型定（「全改」第 4 步），消息照发
    const quiet = readOffscreen(
      reply({ messages: [{ from: "misty", text: "在吗？" }] }),
      withFriend(10),
    );
    expect(quiet.commands.some((c) => c.type === "phone.receive")).toBe(true);
  });
});
