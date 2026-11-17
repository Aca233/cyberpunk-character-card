import type { Command } from "../kernel/system";
import type { WorldState } from "../kernel/world";
import { CityEventFieldsSchema, CityStateSchema } from "../systems/city";
import { CyberwareStateSchema, ripperdocList } from "../systems/cyberware";
import { InventoryStateSchema } from "../systems/inventory";
import { LogisticsStateSchema, routeLocations } from "../systems/logistics";
import { registry } from "../systems/registry";
import { formatGameTime, locationForTravel, withSavedPlaces } from "../systems/world";

type Data = Readonly<Record<string, unknown>>;
const MERCHANT_KEYS: Readonly<Record<string, readonly string[]>> = {
  "logistics.route": ["type", "location", "blocked", "reason", "evidence", "sourceEvent"],
  shopBusiness: [
    "type",
    "shop",
    "action",
    "keeperNpc",
    "serviceNpcs",
    "reason",
    "evidence",
    "sourceEvent",
  ],
  "cyberware.clinic": [
    "type",
    "doc",
    "open",
    "staff",
    "equipment",
    "reason",
    "evidence",
    "sourceEvent",
  ],
};

export const OFFSCREEN_MERCHANT_RULE = `- 商家经营：只处理【已激活商家】中的具体店铺、诊所和它们途经的道路。真实停业/恢复、明确人员或设备变化、真实封路/恢复通行才写 merchantChanges；每项必须有 sourceEvent，指向已有【城里的动静】或本批 events 的 id，evidence 必须逐字引用该事件 title/body 中已经发生的事实。普通营业无需变化，不因全城新闻推导所有商家停业或涨价。已登记订单的到货由本地时间和路况推进，不在这里加库存。不得替玩家买卖、付款、订货、预约、开工或完成手术。未完手术只作为经营约束，不能借经营变化替玩家授权。`;
export const OFFSCREEN_MERCHANT_OUTPUT = `merchantChanges：可省略或 []；只接受以下三类，sourceEvent 与 evidence 必填，字段不得扩展。只改变具体经营条件，不改变玩家款项或身体：
- 商店：{"type":"shopBusiness","shop":"已激活商店 id","action":"open|close|staff","reason":"事实原因","evidence":"事件里的逐字原话","sourceEvent":"事件 id"}；staff 可加 keeperNpc 和 serviceNpcs，必须为已存在在世人物。
- 诊所：{"type":"cyberware.clinic","doc":"已激活诊所 id","open":false,"reason":"事实原因","evidence":"事件里的逐字原话","sourceEvent":"事件 id"}；实际人员或设备变化可写 staff、equipment，不变的字段省略。
- 道路：{"type":"logistics.route","location":"供货路线里的已登记地点 id","blocked":true,"reason":"事实原因","evidence":"事件里的逐字原话","sourceEvent":"事件 id"}；恢复通行 blocked:false。已结束事件不能新建持续封锁。`;

/** 只送出已进入存档的经营状态和未完事项，不把全城货架送给场外模型。 */
export function offscreenMerchantContext(world: WorldState, data: Data): string[] {
  const inventory = InventoryStateSchema.parse(world.slices.inventory);
  const cyberware = CyberwareStateSchema.parse(world.slices.cyberware);
  const logistics = LogisticsStateSchema.parse(world.slices.logistics);
  const docs = new Map(ripperdocList(data, cyberware).map((doc) => [doc.id, doc]));
  const lines: string[] = [];
  const routes = new Set<string>();
  for (const [id, merchant] of Object.entries(inventory.merchants)) {
    const shop = merchant.definition;
    for (const location of shop.supply?.route ?? []) routes.add(location);
    lines.push(
      `- 商店 ${id}｜${shop.name}｜地点 ${shop.location}｜${merchant.open ? "营业" : `停业：${merchant.closureReason ?? "原因未明"}`}｜店主 ${shop.keeperNpc ?? shop.keeper}｜代班 ${shop.serviceNpcs.join("、") || "无登记"}｜现货合计 ${Object.values(merchant.stock).reduce((a, b) => a + b, 0)} 件${shop.supply ? `｜供货方 ${shop.supply.supplier}；来源 ${shop.supply.origin}；路径 ${shop.supply.route.join(" → ")}` : "｜无已知供货关系"}`,
    );
  }
  for (const [id, clinic] of Object.entries(cyberware.clinics)) {
    const doc = docs.get(id);
    lines.push(
      `- 诊所 ${id}｜${doc?.name ?? id}｜地点 ${doc?.location ?? "未登记"}｜${clinic.open ? "营业" : "停业"}：${clinic.reason}｜在册人员 ${clinic.staff.join("、") || "无人物卡"}｜设备 ${clinic.equipment.join("、") || "无"}｜现货合计 ${Object.values(clinic.stock).reduce((a, b) => a + b, 0)} 件`,
    );
  }
  if (!lines.length) return [];
  const supplies: string[] = [];
  for (const order of Object.values(inventory.supplyOrders)) {
    if (!inventory.merchants[order.shop] || !["pending", "delayed"].includes(order.status))
      continue;
    for (const location of order.route) routes.add(location);
    supplies.push(
      `- ${order.id}｜店 ${order.shop}｜${order.item}×${order.quantity}｜供货方 ${order.supplier}；来源 ${order.origin}｜${order.status === "delayed" ? `受阻：${order.delayReason}；剩余运输 ${order.remainingMinutes} 分钟` : `预计 ${formatGameTime(order.dueAt)} 到店`}｜路径 ${order.route.join(" → ")}`,
    );
  }
  for (const supply of Object.values(cyberware.supplies)) {
    if (!cyberware.clinics[supply.doc] || !["pending", "blocked"].includes(supply.status)) continue;
    for (const location of supply.route) routes.add(location);
    supplies.push(
      `- ${supply.id}｜诊所 ${supply.doc}｜${Object.entries(supply.stock)
        .map(([id, count]) => `${id}×${count}`)
        .join(
          "、",
        )}｜来源 ${supply.source}｜${supply.status === "blocked" ? `受阻：${supply.reason}；剩余运输 ${supply.remaining} 分钟` : `预计 ${formatGameTime(supply.due)} 到店`}｜路径 ${supply.route.join(" → ")}`,
    );
  }
  const services = Object.values(cyberware.services)
    .filter((service) => ["booked", "active", "interrupted"].includes(service.status))
    .map(
      (service) =>
        `- ${service.id}｜诊所 ${service.terms.doc}｜医生 ${service.provider} ${service.providerName}｜${service.status}｜内容 ${service.terms.action} ${service.terms.id ?? service.part ?? ""}｜预约 ${formatGameTime(service.scheduledAt)}；预计结束 ${formatGameTime(service.endsAt)}；剩余 ${service.remaining} 分钟｜${service.reason}`,
    );
  const placeData = withSavedPlaces(data, world);
  const routeIds = new Set([...routes].flatMap((id) => routeLocations(data, id)));
  const roads = [...routeIds].map((id) => {
    const place = locationForTravel(placeData, id);
    const blocked = logistics.routes[id];
    return `- ${id}｜${place ? `${place.name}｜${place.district}` : "未登记，不能发出路线变化"}｜${blocked?.blocked ? `受阻：${blocked.reason}；来源 ${blocked.source}` : "未记录封锁"}`;
  });
  return [
    `【已激活商家】\n${lines.join("\n")}`,
    ...(supplies.length ? [`【未完成供货】\n${supplies.join("\n")}`] : []),
    ...(services.length
      ? [`【未完成义体服务】（不得替玩家推进服务）\n${services.join("\n")}`]
      : []),
    ...(roads.length
      ? [
          `【商家供货路线】（只能使用已登记地点，未记录封锁不等于承诺永远安全）\n${roads.join("\n")}`,
        ]
      : []),
  ];
}

/** 经营变化只接受窄指令集合，格式与实际执行使用同一个 schema。 */
export function readOffscreenMerchantChanges(
  raw: unknown,
  world: WorldState,
  events: readonly Command[],
  data: Data,
): { commands: Command[]; notes: string[] } {
  if (raw === undefined) return { commands: [], notes: [] };
  if (!Array.isArray(raw)) return { commands: [], notes: ["merchantChanges 必须是数组"] };
  const commands: Command[] = [];
  const notes: string[] = [];
  const cityEvents = new Map(
    CityStateSchema.parse(world.slices.city ?? {}).events.map((event) => [
      event.id,
      { title: event.title, body: event.body, status: event.status },
    ]),
  );
  for (const command of events) {
    if (command.type !== "city.event") continue;
    const event = CityEventFieldsSchema.parse(command);
    cityEvents.set(event.id, event);
  }
  const inventory = InventoryStateSchema.parse(world.slices.inventory);
  const cyberware = CyberwareStateSchema.parse(world.slices.cyberware);
  const knownRoutes = new Set([
    ...Object.values(inventory.merchants).flatMap(
      (merchant) => merchant.definition.supply?.route ?? [],
    ),
    ...Object.values(inventory.supplyOrders)
      .filter((order) => ["pending", "delayed"].includes(order.status))
      .flatMap((order) => order.route),
    ...Object.values(cyberware.supplies)
      .filter((supply) => ["pending", "blocked"].includes(supply.status))
      .flatMap((supply) => supply.route),
  ]);
  const placeData = withSavedPlaces(data, world);
  const touched = new Set<string>();
  for (const [i, item] of raw.entries()) {
    const reject = (reason: string) => notes.push(`merchantChanges[${i}] ${reason}`);
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      reject("必须是具体经营指令");
      continue;
    }
    const value = item as Record<string, unknown>;
    const type = typeof value.type === "string" ? value.type : "";
    const keys = Object.hasOwn(MERCHANT_KEYS, type) ? MERCHANT_KEYS[type] : undefined;
    if (!keys) {
      reject(`不允许 ${type || "无类型"}；场外经营不能替玩家交易或接受服务`);
      continue;
    }
    if (Object.keys(value).some((key) => !keys.includes(key))) {
      reject("包含未授权字段");
      continue;
    }
    const parsed = registry.commandSchema(type)?.safeParse(value);
    if (!parsed?.success) {
      reject("指令格式不合格");
      continue;
    }
    const command = parsed.data;
    const sourceEvent = typeof command.sourceEvent === "string" ? command.sourceEvent : "";
    const evidence = typeof command.evidence === "string" ? command.evidence : "";
    const event = cityEvents.get(sourceEvent);
    if (!event || !evidence.trim() || !`${event.title}\n${event.body}`.includes(evidence)) {
      reject("必须逐字引用已有或本批城市事件的事实，并填写 sourceEvent");
      continue;
    }
    const target =
      type === "shopBusiness"
        ? command.shop
        : type === "cyberware.clinic"
          ? command.doc
          : command.location;
    if (typeof target !== "string") {
      reject("缺少具体经营对象");
      continue;
    }
    if (
      (type === "shopBusiness" && !inventory.merchants[target]) ||
      (type === "cyberware.clinic" && !cyberware.clinics[target])
    ) {
      reject("只能改变已激活的具体商家");
      continue;
    }
    if (
      type === "logistics.route" &&
      (!routeLocations(data, target).some((id) => knownRoutes.has(id)) ||
        !locationForTravel(placeData, target))
    ) {
      reject("道路不是已激活商家的已登记供货路线");
      continue;
    }
    if (type === "logistics.route" && command.blocked === true && event.status === "over") {
      reject("已结束事件不能新建持续封锁");
      continue;
    }
    const targets = type === "logistics.route" ? routeLocations(data, target) : [target];
    const keysTouched = targets.map((id) => `${type}:${id}`);
    if (keysTouched.some((key) => touched.has(key))) {
      reject("同一对象本批只写一次经营变化");
      continue;
    }
    for (const key of keysTouched) touched.add(key);
    commands.push(command);
  }
  return { commands, notes };
}
