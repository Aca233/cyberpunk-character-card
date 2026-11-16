import type { PlayerView } from "../game";

/** 仅筛选本次提及货物；数值直接来自与成交共用的面板报价，不把整城目录塞进正文。 */
export function merchantContext(view: PlayerView, input: string): string | undefined {
  const text = input.normalize("NFKC").toLowerCase();
  const mentioned = (id: string, name: string) =>
    [id, name, ...name.split(/[\s·()（）-]+/)].some(
      (word) => word.length >= 2 && text.includes(word.toLowerCase()),
    );
  const lines: string[] = [];
  for (const shop of view.shops) {
    for (const item of shop.shelf) {
      if (!mentioned(item.id, item.name)) continue;
      lines.push(
        `${shop.id} ${shop.name}：${item.id} ${item.name}，${item.price} 欧元，剩 ${item.left}${item.locked ? `；不能成交：${item.locked}` : ""}`,
      );
    }
  }
  const doc = view.ripperdoc;
  if (doc) {
    for (const item of doc.shelf) {
      if (!mentioned(item.id, item.name)) continue;
      lines.push(
        `${doc.id} ${doc.name}：${item.id} ${item.name}，${item.installed ? "已经安装" : `报价 ${item.net} 欧元`}${item.replacesId ? `；该展示价以玩家同意回收 ${item.replacesId} 为条件，尚不能代替玩家授权` : ""}${item.locked ? `；不能成交：${item.locked}` : ""}`,
      );
    }
  }
  return lines.length
    ? `【相关商品实际报价】\n${lines.join("\n")}\n报价本身不代表成交；最终按实际货源、已接受条件和交付核验。`
    : undefined;
}
