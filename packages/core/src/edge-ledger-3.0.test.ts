import { describe, expect, it } from "vitest";
import { evaluateHackTopology } from "./netrunning";
import {
  cropNpcPersona,
  evaluatePhoneAvailability,
  type Npc,
  NpcSchema,
  recordSeedEncounter,
} from "./npc";
import { evaluatePhysicsBoundaries } from "./pipeline";
import { advanceTension, type TensionSite, tensionFacts } from "./tension";
import { evaluateDistrictSecurityCheck, settleHousingRentBill } from "./worldClock";

describe("Night City 2077 Qualitative Physics & Living World Rules", () => {
  describe("Netrunning Physical Topology & Air-Gap Reality", () => {
    it("blocks wireless quickhack against air-gapped target unless using directLink", () => {
      const blocked = evaluateHackTopology({
        vector: "wireless",
        targetAirGapped: true,
      });
      expect(blocked.allowed).toBe(false);
      if (!blocked.allowed) {
        expect(blocked.reason).toContain("气隙隔离");
      }

      const direct = evaluateHackTopology({
        vector: "directLink",
        targetAirGapped: true,
      });
      expect(direct.allowed).toBe(true);
      if (direct.allowed) {
        expect(direct.summary).toContain("个人连接线");
      }
    });

    it("blocks wireless quickhack without a cyberdeck or against unchromed meat targets", () => {
      const noDeck = evaluateHackTopology({
        vector: "wireless",
        hasCyberdeck: false,
      });
      expect(noDeck.allowed).toBe(false);

      const unchromed = evaluateHackTopology({
        vector: "wireless",
        targetUnchromed: true,
      });
      expect(unchromed.allowed).toBe(false);
    });

    it("blocks wireless quickhack when target is isolated in an unbreached subnet", () => {
      const blocked = evaluateHackTopology({
        vector: "wireless",
        requiredSubnet: "arasaka-sec-subnet",
        breachedSubnets: ["public-citynet"],
      });
      expect(blocked.allowed).toBe(false);
      if (!blocked.allowed) {
        expect(blocked.reason).toContain("arasaka-sec-subnet");
      }

      const connected = evaluateHackTopology({
        vector: "localSubnet",
        requiredSubnet: "arasaka-sec-subnet",
        breachedSubnets: ["arasaka-sec-subnet"],
        hardenedIce: true,
      });
      expect(connected.allowed).toBe(true);
      if (connected.allowed) {
        expect(connected.summary).toContain("反追踪");
      }
    });
  });

  describe("Qualitative NPC Bonds, Mask vs Secret, Sleep Schedules & Seed Promotion", () => {
    const baseNpc: Npc = NpcSchema.parse({
      id: "evelyn",
      name: "伊芙琳",
      pronoun: "她",
      role: "高端公关顾问",
      affinity: 0,
      look: "穿金色亮片大衣，指尖夹着细长电子烟",
      voice: "语速轻柔但字字留有余地",
      want: "寻找可靠的外包佣兵团队完成私单",
      limit: "绝不在公开场合暴露真实雇主",
      secret: "正被巫毒帮追查，试图绕过中间人私吞 Relic 芯片",
      alive: true,
      met: false,
      location: "lizzie-bar",
      lastSeenAt: 0,
      memories: [],
    });

    it("keeps backstage secrets private even after a life-saving bond", () => {
      const cropped = cropNpcPersona(baseNpc);
      expect(cropped.known).toEqual([]);
      expect(JSON.stringify(cropped)).not.toContain("Relic");

      const bondedNpc: Npc = {
        ...baseNpc,
        met: true,
        relation: { text: "把她从清道夫手里拽出来的救命交情", at: 1200 },
      };
      expect(cropNpcPersona(bondedNpc).known).toEqual([]);
      expect(JSON.stringify(cropNpcPersona(bondedNpc))).not.toContain("Relic");
    });

    it("enforces realistic sleep schedules, busy state, grudge blocking, and seed promotion", () => {
      // 02:30 AM -> dawn hours for unbonded non-night-owl NPC
      const asleep = evaluatePhoneAvailability(baseNpc, 150);
      expect(asleep.answered).toBe(false);
      expect(asleep.reason).toContain("语音信箱");

      // Busy mid-conversation / firefight / meeting -> missed call even for bonded contact
      const busy = evaluatePhoneAvailability(
        {
          ...baseNpc,
          met: true,
          relation: { text: "熟络的线人", at: 100 },
          doing: { text: "正在楼顶躲避枪火交火", at: 500 },
        },
        720,
      );
      expect(busy.answered).toBe(false);
      expect(busy.reason).toContain("交火");

      // Unsettled grudge rejects calls
      const grudgeBlocked = evaluatePhoneAvailability(
        {
          ...baseNpc,
          met: true,
          ledger: [{ kind: "grudge", text: "掀翻了他的货车", at: 200, settledAt: null }],
        },
        720,
      );
      expect(grudgeBlocked.answered).toBe(false);
      expect(grudgeBlocked.reason).toContain("拒接");

      const first = recordSeedEncounter(
        {},
        {
          id: "noodle-boss",
          name: "拉面摊老陈",
          role: "歌舞伎市场拉面摊主",
          location: "watson-kabuki",
          note: "右臂装有老式工业液压义肢",
        },
      );
      expect(first.promoteToFullCard).toBe(false);

      const second = recordSeedEncounter(first.nextSeeds, {
        id: "noodle-boss",
        name: "拉面摊老陈",
        role: "歌舞伎市场拉面摊主",
        location: "watson-kabuki",
        note: "右臂装有老式工业液压义肢",
      });
      expect(second.promoteToFullCard).toBe(true);
      expect(second.seed.encounters).toBe(2);
    });
  });

  describe("District Security, Concealment & Lifestyle Bills", () => {
    it("intercepts open long-arms in City Center unless hidden in Nomad smuggling compartment", () => {
      const intercepted = evaluateDistrictSecurityCheck({
        districtId: "city-center",
        weaponConcealment: "heavy",
      });
      expect(intercepted.passed).toBe(false);

      const smuggled = evaluateDistrictSecurityCheck({
        districtId: "city-center",
        weaponConcealment: "heavy",
        storedInNomadSmugglingCompartment: true,
      });
      expect(smuggled.passed).toBe(true);

      const concealedVisitor = evaluateDistrictSecurityCheck({
        districtId: "city-center",
        weaponConcealment: "pocket",
        enteringHighEndVenue: true,
      });
      expect(concealedVisitor.passed).toBe(true);
    });

    it("locks rented apartment smartlock and cuts utilities when rent is unpaid", () => {
      const unpaid = settleHousingRentBill("H10 的公寓", 1200, 200);
      expect(unpaid.paid).toBe(false);
      expect(unpaid.locked).toBe(true);
      expect(unpaid.summary).toContain("欠费");
    });
  });

  describe("Non-Numeric Tension Facts & Qualitative Physics Boundaries", () => {
    it("tracks concrete hardware damage and exposed weakpoints without progress bars", () => {
      const initial: TensionSite = {
        active: true,
        mode: "stealth",
        exposure: "suspicious",
        backupEtaMinutes: 2,
        backupCause: "已确认北门守卫呼叫邻街巡逻车",
        backupArrived: false,
        exposedWeakpoints: ["机甲背部散热管"],
        scannedEnemyChrome: ["斯安威斯坦 Mk.4"],
        disabledEnemyChrome: [],
      };
      const facts = tensionFacts(initial);
      expect(facts).toContain("已有戒心或异动");
      expect(facts).toContain("机甲背部散热管");
      expect(facts).toContain("约 2 分钟");

      const escalated = advanceTension(initial, {
        exposure: "openConflict",
        elapsedMinutes: 2,
        disableChrome: "斯安威斯坦 Mk.4",
      });
      expect(escalated.exposure).toBe("openConflict");
      expect(escalated.backupEtaMinutes).toBe(0);
      expect(escalated.disabledEnemyChrome).toContain("斯安威斯坦 Mk.4");
    });

    it("emits clean plain-language physical blockers without bracketed telemetry codes", () => {
      const boundary = evaluatePhysicsBoundaries({
        currentEddies: 300,
        spendMoney: 1200,
        securityCheck: {
          districtId: "city-center",
          weaponConcealment: "open",
        },
        hackCheck: {
          vector: "wireless",
          targetAirGapped: true,
        },
        ballisticMismatch: "9mm 民用手枪弹正面击中军用级重甲只会跳弹，打不穿胸板",
      });
      expect(boundary.blocked).toBe(true);
      expect(boundary.directives.length).toBe(4);
      expect(boundary.directives.join("\n")).not.toMatch(/\[TX_DENIED\]|\[HACK_AIRGAPPED\]/);
    });
  });
});
