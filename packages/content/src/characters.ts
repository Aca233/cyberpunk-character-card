import { BoardSchema, CharacterCardSchema } from "@cp/core";
import { boardModules } from "./modules";

const library = (id: string) => {
  const found = boardModules.find((m) => m.id === id);
  if (!found) throw new Error(`模块库里没有 ${id}`);
  return found;
};

/** 洛的主板：库里的模块加两块自写的（车行学徒、欠漩涡帮的债），和他的文字设定对得上 */
const loBoard = BoardSchema.parse({
  origin: library("street-kid"),
  pasts: [
    {
      id: "custom-lo-garage",
      slot: "past",
      label: "改装车行学徒",
      tags: ["车", "技术"],
      ability:
        "在沃森区的地下改装车行摸爬滚打数年：精通引擎爆改、调校与线路隐藏，熟络夜之城的车贩子与地下收赃渠道",
      hook: "车行老板曾协助帮派伪造车架号与武器挂载，那批黑账本上留有你的电子签名",
      people: [
        { name: "老韩", role: "带你入行的车行老油条，虽教了你一身手艺，但也拿你当过替罪羊" },
      ],
      custom: true,
    },
    library("clinic-apprentice"),
    library("smuggler"),
  ],
  skills: [library("mechanic"), library("lockpick"), library("driving")],
  flaws: [
    {
      id: "custom-lo-debt",
      slot: "flaw",
      label: "漩涡帮高利贷",
      tags: ["债务", "帮派"],
      ability: "欠下漩涡帮高利贷三千欧元，日计滞纳金正在疯狂跳动",
      hook: "清算死线迫在眉睫，还不上钱，漩涡帮的改装狂人就会拆下你的器官抵账",
      people: [{ name: "铁钳", role: "全脸改装红色义眼的漩涡帮头目，借钱给你的冷血债主" }],
      custom: true,
    },
  ],
});

/** 手写的示例角色：没有自建角色时可以直接用它开档 */
export const sampleCharacters = CharacterCardSchema.array().parse([
  {
    name: "洛·门多萨",
    alias: "扳手",
    pronoun: "他",
    origin: "街头小子",
    look: "二十出头，身形精瘦而挺拔，顶着干净利落的贴皮平头。双手多处留有被焊枪烫伤与重型扳手崩裂的旧疤痕，常年套着一件洗得发白、下摆沾染机油污渍的灰色工装夹克。",
    past: "在沃森区斑驳破败的筒子楼里挣扎长大，母亲死于一次帮派争夺地盘的流弹火并。十五岁起便在地下车行与黑诊所打杂维生；欠下漩涡帮三千欧元的高利贷，距离最后清算仅剩不到一个月。",
    personality:
      "沉默寡言，恩怨分明，对任何帮派势力抱有本能的戒备；习惯用嘴硬掩饰内心的波澜，唯独见不得街头恶徒对弱者和孩子肆意践踏。",
    voice:
      "语速偏快且短促，说话带着沃森汽修工特有的脏字与黑话，紧张时会下意识揉搓后颈；从不轻易说谢谢，但欠下的人情必定会拿命去还。",
    skills:
      "精通内燃机与底盘调校，熟练绕过普通电子门禁与监控回传；恶土与窄巷驾驶经验丰富。未掌握高阶黑客入侵，未植入攻击型义体，基础枪械射击达标。",
    attributes: { body: 3, reflexes: 3, tech: 5, intelligence: 2, cool: 2 },
    board: loBoard,
  },
]);
