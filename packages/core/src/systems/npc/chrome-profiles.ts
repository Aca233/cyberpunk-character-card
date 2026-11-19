import { cyberwareCatalog, SLOT_CAPACITY } from "../cyberware";
import { NPC_CHROME_MAX, type NpcBodyCard, type NpcCard, type NpcState } from "./schema";

interface ChromeProfile {
  readonly role: RegExp;
  readonly options: readonly string[];
}

// 只用有实际职业用途的基础/罕见部件。专业接入仓配件不会单独代替接入仓。
const PROFILES: readonly ChromeProfile[] = [
  {
    role: /黑客|潜网|网络行者|网行者|\b(?:netrunner|hacker)\b/i,
    options: ["militech-paraline", "biotech-sigma"],
  },
  {
    role: /跑酷|飞檐|攀爬|高空|高架维修|屋顶|翻墙|速递员|信使|快递员|\b(?:courier|climber|parkour)\b/i,
    options: ["clutch-padding", "fortified-ankles", "syn-lungs"],
  },
  {
    role: /潜入|潜伏特工|卧底特工|夜行者|窃贼|盗贼|\b(?:infiltrator|burglar|sneak)\b/i,
    options: ["lynx-paws", "clutch-padding", "atomic-sensors"],
  },
  {
    role: /电工|焊工|焊接|检修|机修|维修工|维修技|机械师|修车|修理工|设备技师|义体技师|\b(?:electrician|welder|mechanic|technician|rigger)\b/i,
    options: ["grounding-plating", "fireproof-coating", "clutch-padding"],
  },
  {
    role: /搬运工|装卸工|港口工人|码头工人|码头工|仓库工人|矿工|负重|\b(?:dockworker|longshoreman|loader|miner)\b/i,
    options: ["titanium-bones", "clutch-padding", "syn-lungs"],
  },
  {
    role: /战地医护|战地医生|战地医师|战地护士|医疗兵|急救员|救护员|救援队员|\b(?:paramedic|combat medic|rescue worker)\b/i,
    options: ["biomonitor", "syn-lungs"],
  },
  {
    role: /狙击手|枪手|射手|神枪手|\b(?:sniper|marksman|gunner|gunslinger)\b/i,
    options: ["clutch-padding", "bionic-joints", "visual-cortex-support"],
  },
  {
    role: /格斗手|格斗家|拳手|拳击手|摔跤手|近战手|\b(?:boxer|brawler|wrestler)\b/i,
    options: ["neofiber", "syn-lungs", "dense-marrow", "spring-joints"],
  },
  {
    role: /佣兵|雇佣兵|打手|杀手|收债人|收账人|清道夫|保镖|安保|保安|警员|警察|警探|守卫|哨兵|巡警|暴恐机动队|民兵|士兵|突击队员|\b(?:mercenary|enforcer|bodyguard|security guard|guard|police|soldier|militia)\b/i,
    options: ["subdermal-armor", "biomonitor", "neofiber", "clutch-padding", "threatevac"],
  },
];

const AUGMENTED_GANG_MEMBERS = /帮众|帮派成员|马仔|小弟|混混|喽啰|\bgang(?:ster| member)\b/i;

/** 只为已有充分身份线索的人提供候选。帮派归属本身不足以推定植入物。 */
function npcChromeOptions(role: string, faction: string): readonly string[] {
  const profile = PROFILES.find((profile) => profile.role.test(role));
  if (profile) return profile.options;

  if (AUGMENTED_GANG_MEMBERS.test(role)) {
    if (faction === "maelstrom") return ["subdermal-armor", "neofiber", "biomonitor"];
    if (faction === "animals") return ["dense-marrow", "syn-lungs", "spring-joints"];
  }
  return [];
}
// 仅承认完整配置事实。可见的一枚义眼不能代表扫描结果或全身没有别的植入物。
const COMPLETE_CHROME =
  /(?:(?:没有|从没|从未|不曾|未曾|没(?:有)?装|未安装|未植入|无)(?:装过|安装过|植入过|安装|植入|任何|一件|一枚|过|着|一丁点)?(?:任何|一件|一枚)?(?:义体|植入体|植入物)|纯肉体|全身(?:上下)?(?:就|只|仅|只有|仅有|也就)|(?:除了|除去).{1,24}(?:没有(?:别的|其他)?|再无|没有安装任何)(?:义体|植入体|植入物)|(?:义体|植入体|植入物)(?:扫描结果)?(?:只|仅|一共|总共)(?:显示|有|装了)?|(?:扫描(?:结果)?|义眼扫描).{0,80}(?:显示|确认|列出|识别))/u;
const NO_CHROME =
  /(?:没有|没(?:有)?装|未装|未安装|未植入|无|全身无|没有任何).{0,8}(?:义体|植入体|植入物)|纯肉体|(?:义体|植入体|植入物).{0,8}(?:全部拆除|都没有|全无)/u;

/** 只在人物第一次定型时补职业植入。保持明确事实与已选型号，并让同类人物用到不同部件。 */
export function completeNpcChrome(
  person: Pick<NpcCard, "id" | "age" | "adult" | "entity" | "role" | "faction">,
  body: NpcBodyCard,
  others: NpcState["npcs"],
  data: Readonly<Record<string, unknown>>,
  narrative: string,
  completeEvidence: string | undefined,
  notes: string[],
): NpcBodyCard {
  if (
    person.adult === false ||
    (person.age !== undefined && person.age < 18) ||
    (person.entity !== undefined && person.entity !== "human") ||
    body.cyberware.length >= NPC_CHROME_MAX
  ) {
    return body;
  }
  const complete =
    completeEvidence !== undefined &&
    narrative.includes(completeEvidence) &&
    COMPLETE_CHROME.test(completeEvidence);
  if (complete) {
    if (NO_CHROME.test(completeEvidence) && body.cyberware.length > 0) {
      notes.push("正文明确此人没有植入义体，按事实清空初始义体栏");
      return { ...body, cyberware: [] };
    }
    return body;
  }
  const catalog = cyberwareCatalog(data);
  const options = npcChromeOptions(person.role, person.faction).flatMap((id) => {
    const part = catalog.get(id);
    return part && !part.iconic && part.slot !== "eyes" ? [part] : [];
  });
  if (options.length === 0) return body;

  const installed = body.cyberware.flatMap((id) => {
    const part = catalog.get(id);
    return part ? [part] : [];
  });
  const needsDeck = options.every((part) => part.deckTraits !== undefined && part.slot === "os");
  if (
    needsDeck
      ? installed.some((part) => part.slot === "os")
      : installed.some((part) => part.slot !== "eyes")
  ) {
    return body;
  }

  const counts = new Map<string, number>();
  for (const npc of Object.values(others)) {
    if (npc.id === person.id || npc.canon || !npc.met) continue;
    for (const id of npc.body?.cyberware ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  // 同频候选按人物 ID 稳定起步，保持重试结果一致；同轮较早成功建卡的人也计入使用次数。
  let offset = 0;
  for (const char of person.id) offset = (offset * 31 + char.charCodeAt(0)) % options.length;
  const part = [...options.slice(offset), ...options.slice(0, offset)]
    .filter(
      (part) =>
        installed.filter((other) => other.slot === part.slot).length < SLOT_CAPACITY[part.slot],
    )
    .sort((a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0))[0];
  if (!part) return body;

  notes.push(`初始职业义体：${part.name}`);
  return { ...body, cyberware: [...body.cyberware, part.id] };
}
