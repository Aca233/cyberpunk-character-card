import { npcRules } from "@cp/core";
import { useMemo, useState } from "react";
import type { BoardData, CanonNpcBrief } from "../../api/client";
import { ActionButton } from "../../ui/ActionButton";
import { Asset } from "../../ui/Asset";
import { Button } from "../../ui/Button";
import { CellFrame } from "../../ui/FrameBox";
import { useCardTilt } from "../../ui/useCardTilt";
import { portraitOf } from "../story/art";
import wb from "./workbench.module.css";

const { NPC_CIRCLES, NPC_CIRCLE_LABELS, NO_FACTION, inferNpcCircle } = npcRules;

export type NpcRosterCircleFilter = "all" | "custom" | "overridden" | npcRules.NpcCircle;

export interface NpcRosterItem {
  readonly id: string;
  readonly name: string;
  readonly alias?: string;
  readonly role: string;
  readonly look: string;
  readonly faction?: string;
  readonly circle: npcRules.NpcCircle;
  readonly gearCount: number;
  readonly cyberwareCount: number;
  readonly isCustom: boolean;
  readonly hasOverride: boolean;
  readonly packId?: string;
}

export function NpcRosterPanel({
  data,
  localCustomNpcs,
  localOverrides,
  query,
  loadingNpcId,
  busy,
  onCreateNpc,
  onEditCustom,
  onEditCanon,
  onResetOverride,
  onDeleteCustom,
  onClearQuery,
}: {
  readonly data?: BoardData | undefined;
  readonly localCustomNpcs: readonly npcRules.NpcCard[];
  readonly localOverrides: readonly npcRules.NpcCard[];
  readonly query: string;
  readonly loadingNpcId: string | null;
  readonly busy: boolean;
  readonly onCreateNpc: () => void;
  readonly onEditCustom: (card: npcRules.NpcCard) => void;
  readonly onEditCanon: (brief: CanonNpcBrief, existingOverride?: npcRules.NpcCard) => void;
  readonly onResetOverride: (id: string) => void;
  readonly onDeleteCustom: (card: npcRules.NpcCard) => void;
  readonly onClearQuery: () => void;
}) {
  const [circleFilter, setCircleFilter] = useState<NpcRosterCircleFilter>("all");

  const factionNames = useMemo(
    () => new Map((data?.factions ?? []).map((f) => [f.id, f.name] as const)),
    [data?.factions],
  );

  const overrideMap = useMemo(
    () => new Map(localOverrides.map((c) => [c.id, c] as const)),
    [localOverrides],
  );

  const customCardMap = useMemo(
    () => new Map(localCustomNpcs.map((c) => [c.id, c] as const)),
    [localCustomNpcs],
  );

  const customItems = useMemo<readonly NpcRosterItem[]>(
    () =>
      localCustomNpcs.map((c) => ({
        id: c.id,
        name: c.name,
        ...(c.alias ? { alias: c.alias } : {}),
        role: c.role,
        look: c.look,
        ...(c.faction && c.faction !== NO_FACTION ? { faction: c.faction } : {}),
        circle: inferNpcCircle(c),
        gearCount: c.body?.gear.length ?? 0,
        cyberwareCount: c.body?.cyberware.length ?? 0,
        isCustom: true,
        hasOverride: false,
      })),
    [localCustomNpcs],
  );

  const canonItems = useMemo<readonly NpcRosterItem[]>(
    () =>
      (data?.npcs ?? []).map((n) => {
        const ov = overrideMap.get(n.id);
        const effFaction = ov ? ov.faction : n.faction;
        const effRole = ov ? ov.role : n.role;
        const effCircle =
          ov?.circle ??
          (n.circle && (NPC_CIRCLES as readonly string[]).includes(n.circle)
            ? (n.circle as npcRules.NpcCircle)
            : inferNpcCircle({ faction: effFaction, role: effRole }));
        return {
          id: n.id,
          name: ov?.name ?? n.name,
          ...(ov?.alias || n.alias ? { alias: ov?.alias ?? n.alias } : {}),
          role: effRole,
          look: ov?.look ?? n.look,
          ...(effFaction && effFaction !== NO_FACTION ? { faction: effFaction } : {}),
          circle: effCircle,
          gearCount: ov ? (ov.body?.gear.length ?? 0) : (n.gearCount ?? 0),
          cyberwareCount: ov ? (ov.body?.cyberware.length ?? 0) : (n.cyberwareCount ?? 0),
          isCustom: false,
          hasOverride: Boolean(ov),
          ...(n.packId ? { packId: n.packId } : {}),
        };
      }),
    [data?.npcs, overrideMap],
  );

  const briefMap = useMemo(
    () => new Map((data?.npcs ?? []).map((n) => [n.id, n] as const)),
    [data?.npcs],
  );

  const allItems = useMemo(() => [...customItems, ...canonItems], [customItems, canonItems]);

  const circleCounts = useMemo(() => {
    const counts = new Map<npcRules.NpcCircle, number>();
    for (const item of allItems) {
      counts.set(item.circle, (counts.get(item.circle) ?? 0) + 1);
    }
    return counts;
  }, [allItems]);

  const normalizedQuery = query.trim().toLowerCase();
  const matches = (item: NpcRosterItem): boolean => {
    if (circleFilter === "custom" && !item.isCustom) return false;
    if (circleFilter === "overridden" && !item.hasOverride) return false;
    if (
      circleFilter !== "all" &&
      circleFilter !== "custom" &&
      circleFilter !== "overridden" &&
      item.circle !== circleFilter
    ) {
      return false;
    }
    if (!normalizedQuery) return true;
    const facName = item.faction ? (factionNames.get(item.faction) ?? item.faction) : "";
    const hay = `${item.name} ${item.alias ?? ""} ${item.role} ${facName} ${NPC_CIRCLE_LABELS[item.circle]} ${item.look}`;
    return hay.toLowerCase().includes(normalizedQuery);
  };

  const filteredCustom = customItems.filter(matches);
  const filteredCanon = canonItems.filter(matches);
  const totalShown = filteredCustom.length + filteredCanon.length;

  return (
    <div className={wb.npcRosterWrap}>
      <fieldset className={wb.npcFilterBar} aria-label="按圈层筛选夜之城人物">
        <Button small pressed={circleFilter === "all"} onClick={() => setCircleFilter("all")}>
          全部 ({allItems.length})
        </Button>
        {customItems.length > 0 && (
          <Button
            small
            pressed={circleFilter === "custom"}
            onClick={() => setCircleFilter("custom")}
          >
            自建 NPC ({customItems.length})
          </Button>
        )}
        {localOverrides.length > 0 && (
          <Button
            small
            pressed={circleFilter === "overridden"}
            onClick={() => setCircleFilter("overridden")}
          >
            已改写 ({localOverrides.length})
          </Button>
        )}
        {NPC_CIRCLES.map((c) => {
          const count = circleCounts.get(c) ?? 0;
          if (count === 0) return null;
          return (
            <Button key={c} small pressed={circleFilter === c} onClick={() => setCircleFilter(c)}>
              {NPC_CIRCLE_LABELS[c]} ({count})
            </Button>
          );
        })}
      </fieldset>

      {totalShown === 0 && (
        <div className={wb.rosterEmpty}>
          <p className={wb.note}>
            {normalizedQuery ? `没有匹配「${query}」的人物档案。` : "当前筛选条件下没有人物档案。"}
          </p>
          <div className={wb.draftBannerActions}>
            {normalizedQuery && (
              <Button small onClick={onClearQuery}>
                清空搜索
              </Button>
            )}
            {circleFilter !== "all" && (
              <Button small onClick={() => setCircleFilter("all")}>
                显示全部人物
              </Button>
            )}
            <Button small primary onClick={onCreateNpc}>
              ＋ 新建 NPC
            </Button>
          </div>
        </div>
      )}

      {filteredCustom.length > 0 && (
        <section className={wb.rosterSection} aria-label="自建 NPC 档案">
          <div className={wb.rosterSectionHead}>
            <h2 className={wb.rosterSectionTitle}>自建 NPC（{filteredCustom.length}）</h2>
            <span className={wb.rosterSectionHint}>
              与预设人物同等生效于新存档，也可在建档人脉中设为初始旧识
            </span>
          </div>
          <ul className={wb.rosterGrid}>
            {filteredCustom.map((item) => {
              const card = customCardMap.get(item.id);
              if (!card) return null;
              return (
                <NpcRosterCard
                  key={item.id}
                  item={item}
                  factionLabel={
                    item.faction ? (factionNames.get(item.faction) ?? item.faction) : undefined
                  }
                  loading={loadingNpcId === item.id}
                  busy={busy}
                  onOpen={() => onEditCustom(card)}
                  onDelete={() => onDeleteCustom(card)}
                />
              );
            })}
          </ul>
        </section>
      )}

      {filteredCanon.length > 0 && (
        <section className={wb.rosterSection} aria-label="夜之城原作与世界 NPC">
          <div className={wb.rosterSectionHead}>
            <h2 className={wb.rosterSectionTitle}>夜之城原作人物（{filteredCanon.length}）</h2>
            <span className={wb.rosterSectionHint}>
              点击任意人物即可进入同款 2077 工作台修改资料、义体与随身装备，随时可一键恢复原作默认
            </span>
          </div>
          <ul className={wb.rosterGrid}>
            {filteredCanon.map((item) => {
              const brief = briefMap.get(item.id);
              if (!brief) return null;
              return (
                <NpcRosterCard
                  key={item.id}
                  item={item}
                  factionLabel={
                    item.faction ? (factionNames.get(item.faction) ?? item.faction) : undefined
                  }
                  loading={loadingNpcId === item.id}
                  busy={busy}
                  onOpen={() => onEditCanon(brief, overrideMap.get(item.id))}
                  onReset={item.hasOverride ? () => onResetOverride(item.id) : undefined}
                />
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function NpcRosterCard({
  item,
  factionLabel,
  loading,
  busy,
  onOpen,
  onReset,
  onDelete,
}: {
  readonly item: NpcRosterItem;
  readonly factionLabel?: string | undefined;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly onOpen: () => void;
  readonly onReset?: (() => void) | undefined;
  readonly onDelete?: (() => void) | undefined;
}) {
  const face = !item.isCustom ? portraitOf(item.id) : undefined;
  const monogram = ([...item.name][0] ?? "?").toUpperCase();
  const tilt = useCardTilt<HTMLLIElement>({
    maxRotate: 4.8,
    shadowShift: 4,
    disabled: busy || loading,
  });

  return (
    <li className={wb.rosterCard} {...tilt}>
      <CellFrame />
      <button
        type="button"
        className={wb.rosterCardMain}
        disabled={busy || loading}
        onClick={onOpen}
      >
        <span className={wb.rosterThumb}>
          {face ? (
            <Asset id={face} className={wb.portraitImg} />
          ) : (
            <span className={wb.rosterMonogram} aria-hidden>
              {monogram}
            </span>
          )}
        </span>
        <div className={wb.rosterMeta}>
          <div className={wb.rosterTopRow}>
            <span
              className={wb.rosterBadge}
              data-sample={!item.isCustom && !item.hasOverride ? "" : undefined}
            >
              {item.isCustom ? "自建 NPC" : item.hasOverride ? "已改写" : "原作人物"}
            </span>
            <span className={wb.rosterOrigin}>
              {NPC_CIRCLE_LABELS[item.circle]}
              {factionLabel ? ` · ${factionLabel}` : ""}
            </span>
          </div>
          <strong className={wb.rosterName}>
            {item.name}
            {item.alias ? <span className={wb.rosterAlias}>「{item.alias}」</span> : null}
          </strong>
          <span className={wb.rosterStats}>
            {item.role} · 义体 {item.cyberwareCount} · 装备 {item.gearCount}
          </span>
          {item.look && <p className={wb.rosterSummary}>{item.look}</p>}
        </div>
      </button>
      <div className={wb.rosterActions}>
        <Button small primary disabled={busy || loading} onClick={onOpen}>
          {loading ? "读取中…" : item.isCustom ? "编辑档案" : "修改档案"}
        </Button>
        {onReset && <ActionButton onClick={onReset}>恢复默认</ActionButton>}
        {onDelete && (
          <Button small disabled={busy} onClick={onDelete}>
            删除
          </Button>
        )}
      </div>
    </li>
  );
}
