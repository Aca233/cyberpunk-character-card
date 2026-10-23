import type { Twist } from "@cp/core";

/** 转折和两难素材：主持人挂委托或推剧情时取用，不强制套用 */
export const twists: readonly Twist[] = [
  {
    id: "target-already-dead",
    kind: "twist",
    text: "目标已经死了：有人抢先下手，或者目标自己伪造了死亡；到现场只找到尸体、替身或者一场布置好的戏，委托人未必知情。",
  },
  {
    id: "client-is-bait",
    kind: "twist",
    text: "委托人是诱饵：真正的雇主想借这单把角色引到某个地方、拖住某件事，或者让角色替人背锅。",
  },
  {
    id: "cargo-is-alive",
    kind: "twist",
    text: "货是活的：要运的“货”其实是一个人——偷渡客、逃出来的实验体、被绑的孩子——会说话，也会求你。",
  },
  {
    id: "innocent-witness",
    kind: "dilemma",
    text: "无辜的目击者：动手时撞见一个和这事无关的人（清洁工、孩子、路过的情侣）；放走会留下线索，灭口要赔人性。",
  },
  {
    id: "double-offer",
    kind: "dilemma",
    text: "两头出价：干到一半，目标或对手开出更高的价钱让角色反水；收了得罪中间人，不收就多一个敌人。",
  },
];
