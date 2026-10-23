import { CharacterCardSchema } from "@cp/core";

/** 手写的示例角色：没有自建角色时可以直接用它开档 */
export const sampleCharacters = CharacterCardSchema.array().parse([
  {
    name: "洛·门多萨",
    alias: "扳手",
    pronoun: "他",
    origin: "街头小子",
    look: "二十出头，瘦高，寸头，左手指关节上有烫伤的疤，总穿一件洗褪色的车行工装外套。",
    past: "在沃森区的公寓楼里长大，母亲死于一次帮派火并。十五岁起在车行和小诊所打零工；欠了漩涡帮一个小头目三千欧元，下个月到期。",
    personality: "话少，记仇，对帮派没好感；嘴硬心软，看不得别人欺负小孩。",
    voice: "说话短，爱用车行里的黑话，紧张时会摸后脑勺；很少说谢谢，但会记着还人情。",
    skills: "会修车、懂一点电子锁和监控；开车很稳。不会骇客，没装战斗义体，枪法一般。",
    attributes: { body: 4, reflexes: 5, tech: 6, intelligence: 4, cool: 3 },
  },
]);
