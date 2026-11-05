import { describe, expect, it } from "vitest";
import { evaluateHackTopology } from "./netrunning";
import {
  computeNpcVectors,
  cropNpcPersona,
  evaluateBetrayal,
  evaluatePhoneAvailability,
  isCoreTruthUnlocked,
  type Npc,
  NpcSchema,
  recordSeedEncounter,
} from "./npc";
import { computeLootBudgetCap, evaluatePhysicsBoundaries } from "./pipeline";
import { advanceTension, buildTensionSensoryDirective, type TensionState } from "./tension";
import {
  evaluateCorpoStanding,
  evaluateDistrictSecurityCheck,
  rollSecondhandCyberwareDefect,
  settleWeeklyLifestyleBill,
} from "./worldClock";

describe("Edge Ledger 3.0 — Realistic Night City Simulation", () => {
  describe("Netrunning Topology, Air-Gap & ICE Resistance", () => {
    it("blocks wireless quickhack against air-gapped target unless using directLink", () => {
      const blocked = evaluateHackTopology({
        vector: "wireless",
        deckTier: 3,
        targetIceTier: 2,
        baseRamCost: 3,
        availableRam: 8,
        targetAirGapped: true,
      });
      expect(blocked.allowed).toBe(false);
      if (!blocked.allowed) {
        expect(blocked.code).toBe("HACK_AIRGAPPED");
      }

      const direct = evaluateHackTopology({
        vector: "directLink",
        deckTier: 3,
        targetIceTier: 2,
        baseRamCost: 3,
        availableRam: 8,
        targetAirGapped: true,
      });
      expect(direct.allowed).toBe(true);
      if (direct.allowed) {
        expect(direct.ramCost).toBe(3);
        expect(direct.requiresIceCheck).toBe(false);
      }
    });

    it("blocks wireless quickhack when target is on an isolated subnet", () => {
      const blocked = evaluateHackTopology({
        vector: "wireless",
        deckTier: 2,
        targetIceTier: 2,
        baseRamCost: 2,
        availableRam: 6,
        requiredSubnet: "arasaka-sec-subnet",
        breachedSubnets: ["public-citynet"],
      });
      expect(blocked.allowed).toBe(false);
      if (!blocked.allowed) {
        expect(blocked.code).toBe("HACK_SUBNET_ISOLATED");
      }

      const connected = evaluateHackTopology({
        vector: "localSubnet",
        deckTier: 2,
        targetIceTier: 2,
        baseRamCost: 2,
        availableRam: 6,
        requiredSubnet: "arasaka-sec-subnet",
        breachedSubnets: ["arasaka-sec-subnet"],
      });
      expect(connected.allowed).toBe(true);
    });

    it("doubles RAM cost and requires ICE check when hacking higher-tier ICE over wireless", () => {
      const res = evaluateHackTopology({
        vector: "wireless",
        deckTier: 2,
        targetIceTier: 3,
        baseRamCost: 3,
        availableRam: 8,
      });
      expect(res.allowed).toBe(true);
      if (res.allowed) {
        expect(res.ramCost).toBe(6);
        expect(res.requiresIceCheck).toBe(true);
      }
    });
  });

  describe("Autonomous NPC Vectors, Dual-Layer Persona Lock & Betrayal", () => {
    const baseNpc: Npc = NpcSchema.parse({
      id: "evelyn",
      name: "伊芙琳",
      role: "高端公关顾问",
      affinity: -10,
      look: "穿金色亮片大衣，指尖夹着细长电子烟",
      voice: "语速轻柔但字字留有余地",
      want: "寻找可靠的外包佣兵团队完成私单",
      secret: "正被巫毒帮追查，试图绕过中间人私吞 Relic 芯片",
    });

    it("crops CoreTruth when trust < 40 and leverage < 40, and unlocks when threshold met", () => {
      const lowVectors = computeNpcVectors(baseNpc);
      expect(isCoreTruthUnlocked(baseNpc)).toBe(false);
      expect(lowVectors.trust).toBeLessThan(40);

      const cropped = cropNpcPersona(baseNpc);
      expect(cropped.coreTruthUnlocked).toBe(false);
      expect(cropped.coreSecret).toBeNull();

      const unlockedNpc: Npc = {
        ...baseNpc,
        vectors: { trust: 20, leverage: 55, respect: 30 },
      };
      expect(isCoreTruthUnlocked(unlockedNpc)).toBe(true);
      const unlocked = cropNpcPersona(unlockedNpc);
      expect(unlocked.coreTruthUnlocked).toBe(true);
      expect(unlocked.coreSecret).toContain("Relic");
    });

    it("triggers betrayal mathematically when external temptation exceeds trust + respect", () => {
      const betray = evaluateBetrayal(
        {
          ...baseNpc,
          vectors: { trust: 20, leverage: 10, respect: 25 },
        },
        60, // 60 > 20 + 25 (45)
      );
      expect(betray.betrayed).toBe(true);

      const loyal = evaluateBetrayal(
        {
          ...baseNpc,
          vectors: { trust: 45, leverage: 10, respect: 40 },
        },
        60, // 60 <= 45 + 40 (85)
      );
      expect(loyal.betrayed).toBe(false);
    });

    it("enforces NPC sleep schedule on phone calls and promotes ambient seed after 2 encounters", () => {
      // 02:30 AM (minute 150) -> dawn/night hours for non-night-owl role
      const asleep = evaluatePhoneAvailability(baseNpc, 150);
      expect(asleep.answered).toBe(false);
      expect(asleep.reason).toContain("免打扰");

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

  describe("District Security, Concealment & Corporate HR vs Counter-Intel", () => {
    it("intercepts open long-arms in City Center unless stored in Nomad smuggling compartment", () => {
      const intercepted = evaluateDistrictSecurityCheck({
        districtId: "city-center",
        weaponConcealment: "heavy",
        styleTag: "neomilitarism",
      });
      expect(intercepted.passed).toBe(false);
      if (!intercepted.passed) {
        expect(intercepted.code).toBe("SECURITY_OPEN_WEAPON");
      }

      const smuggled = evaluateDistrictSecurityCheck({
        districtId: "city-center",
        weaponConcealment: "heavy",
        storedInNomadSmugglingCompartment: true,
        styleTag: "neomilitarism",
      });
      expect(smuggled.passed).toBe(true);

      const dressDenied = evaluateDistrictSecurityCheck({
        districtId: "city-center",
        weaponConcealment: "pocket",
        styleTag: "entropism",
        enteringHighEndVenue: true,
      });
      expect(dressDenied.passed).toBe(false);
      if (!dressDenied.passed) {
        expect(dressDenied.code).toBe("VENUE_DRESS_GATE");
      }
    });

    it("distinguishes corporate HR termination (KPI < 30) from Counter-Intel hit squads (data theft)", () => {
      const kpiFired = evaluateCorpoStanding({
        rank: "C2",
        kpi: 20,
      });
      expect(kpiFired.status).toBe("hrTerminated");
      if (kpiFired.status === "hrTerminated") {
        expect(kpiFired.drmLocked).toBe(true);
        expect(kpiFired.penaltyDebt).toBe(4000);
      }

      const dataTheft = evaluateCorpoStanding({
        rank: "C2",
        kpi: 75,
        stoleClassifiedData: true,
      });
      expect(dataTheft.status).toBe("counterIntelHitSquad");
      if (dataTheft.status === "counterIntelHitSquad") {
        expect(dataTheft.drmLocked).toBe(true);
      }
    });

    it("rolls secondhand cyberware defects and settles weekly lifestyle bills", () => {
      const defectRng = {
        roll: (sides: number) => (sides === 100 ? 10 : 1),
      };
      const defect = rollSecondhandCyberwareDefect(defectRng);
      expect(defect.hasDefect).toBe(true);
      expect(defect.kind).toBe("neuralRejection");
      expect(defect.extraHumanityCost).toBe(3);

      const cleanRng = {
        roll: () => 80,
      };
      expect(rollSecondhandCyberwareDefect(cleanRng).hasDefect).toBe(false);

      const unpaid = settleWeeklyLifestyleBill("standard", 200);
      expect(unpaid.paid).toBe(false);
      expect(unpaid.evictedOrLocked).toBe(true);
    });
  });

  describe("Black-Box Tension & 3-Step Neuro-Symbolic Physics Boundaries", () => {
    it("escalates tension exposure stages and builds sensory directives without progress bars", () => {
      const initial: TensionState = {
        active: true,
        mode: "stealth",
        exposure: "suspicious",
        risk: 1,
        backupEtaMinutes: 2,
        exposedWeakpoints: ["机甲背部散热管"],
        scannedEnemyChrome: ["斯安威斯坦 Mk.4"],
        disabledEnemyChrome: [],
      };
      const sensory = buildTensionSensoryDirective(initial);
      expect(sensory).toContain("引起警觉");
      expect(sensory).toContain("机甲背部散热管");
      expect(sensory).toContain("增援迫近感官");

      const escalated = advanceTension(initial, {
        riskDelta: 3,
        elapsedMinutes: 2,
        disableChrome: "斯安威斯坦 Mk.4",
      });
      expect(escalated.exposure).toBe("openConflict");
      expect(escalated.backupEtaMinutes).toBe(0);
      expect(escalated.disabledEnemyChrome).toContain("斯安威斯坦 Mk.4");
    });

    it("locks physical boundaries in Step 1 before LLM narration", () => {
      const boundary = evaluatePhysicsBoundaries({
        currentEddies: 300,
        spendMoney: 1200,
        securityCheck: {
          districtId: "city-center",
          weaponConcealment: "open",
          styleTag: "entropism",
        },
        hackCheck: {
          vector: "wireless",
          deckTier: 2,
          targetIceTier: 2,
          baseRamCost: 2,
          availableRam: 6,
          targetAirGapped: true,
        },
      });
      expect(boundary.blocked).toBe(true);
      expect(boundary.flags).toContain("[TX_DENIED]");
      expect(boundary.flags).toContain("[SECURITY_OPEN_WEAPON]");
      expect(boundary.flags).toContain("[HACK_AIRGAPPED]");
      expect(computeLootBudgetCap(2).maxEddies).toBe(600);
    });
  });
});
