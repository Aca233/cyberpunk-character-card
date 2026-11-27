import type { CharacterCard } from "@cp/core";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useLocation } from "react-router";
import {
  api,
  type CharacterEntry,
  type SaveImageBindings,
  type SaveSummary,
  turnImagesOf,
} from "../api/client";
import { backdropOf, itemArtOf, portraitOf, shopPoiIconOf } from "../features/story/art";
import { vehicleArtOf } from "../features/story/vehicle-art";
import type { View } from "../features/story/view";
import { isCustomImageAssetId } from "./customArt";
import type { AssetId } from "./index";
import {
  preloadAsset,
  preloadAssets,
  preloadBackgroundCatalog,
  preloadBootAssets,
  preloadCharacterWorkbenchAssets,
  preloadMapAssets,
  preloadStoryShellAssets,
  setPreloadBusy,
} from "./preload";

/**
 * React Query 数据预热与路由/局面级精准预载 hooks：
 * - 启动期预填主菜单与本地词典缓存，并顺手预热最近一份存档的状态与地点背景。
 * - 按当前路由提升对应页面资源优先级；剧情回合生成期间自动暂停低优后台预载。
 * - 进入剧情与角色工作台后，针对当前可见/即将触达的地点、人物、装备、义体与生成立绘做高优预载。
 */

const byNewest = (a: SaveSummary, b: SaveSummary) => b.createdAt.localeCompare(a.createdAt);

function prefetchStoredImage(queryClient: QueryClient, imageId: string | null | undefined): void {
  const id = imageId?.trim();
  if (!id) return;
  void queryClient
    .prefetchQuery({
      queryKey: ["image", id],
      queryFn: () => api.getImage(id),
      staleTime: Number.POSITIVE_INFINITY,
    })
    .catch(() => {});
}

/** 预热指定存档的 state / saveImages 缓存，并高优预载其当前地点背景图 */
function warmSaveEntry(queryClient: QueryClient, saveId: string): void {
  if (!saveId) return;
  void queryClient
    .prefetchQuery({
      queryKey: ["saveImages", saveId],
      queryFn: () => api.saveImages(saveId),
      staleTime: 15_000,
    })
    .catch(() => {});

  void queryClient
    .fetchQuery({
      queryKey: ["state", saveId],
      queryFn: () => api.state(saveId),
      staleTime: 15_000,
    })
    .then((view) => {
      const district =
        view.names.district ?? view.travel.destinations.find((d) => d.here)?.district ?? null;
      const bg = backdropOf({
        location: view.location,
        locationName: view.names.location,
        district,
        period: view.time.period,
      });
      void preloadAsset(bg, "high", { decode: true });
    })
    .catch(() => {});
}

let initialQueriesWarmed = false;

/** 启动画面期间静默预热主菜单与通用静态查询缓存，消除首次进入主菜单/点击继续的等待 */
export function warmInitialQueries(queryClient: QueryClient): void {
  if (initialQueriesWarmed) return;
  initialQueriesWarmed = true;

  void queryClient
    .prefetchQuery({ queryKey: ["health"], queryFn: api.health, staleTime: 10_000 })
    .catch(() => {});
  void queryClient
    .prefetchQuery({ queryKey: ["characters"], queryFn: api.characters, staleTime: 15_000 })
    .catch(() => {});
  void queryClient
    .prefetchQuery({ queryKey: ["profiles"], queryFn: api.profiles, staleTime: 15_000 })
    .catch(() => {});
  void queryClient
    .prefetchQuery({
      queryKey: ["characterBoard"],
      queryFn: api.characterBoard,
      staleTime: Number.POSITIVE_INFINITY,
    })
    .catch(() => {});
  void queryClient
    .prefetchQuery({
      queryKey: ["glossary"],
      queryFn: api.glossary,
      staleTime: Number.POSITIVE_INFINITY,
    })
    .catch(() => {});

  void queryClient
    .fetchQuery({ queryKey: ["saves"], queryFn: api.saves, staleTime: 15_000 })
    .then((saves) => {
      const latest = [...saves].sort(byNewest)[0];
      if (latest) warmSaveEntry(queryClient, latest.id);
    })
    .catch(() => {});
}

/** 挂在根路由 Shell 中：根据路由阶段编排预载节奏，并在回合生成忙碌时暂停后台低优预热 */
export function useRoutePreload(busy: boolean): void {
  const { pathname } = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    setPreloadBusy(busy);
    return () => setPreloadBusy(false);
  }, [busy]);

  useEffect(() => {
    if (pathname === "/") {
      void preloadBootAssets().then(() => {
        preloadStoryShellAssets("normal");
        preloadMapAssets("normal");
        preloadBackgroundCatalog();
      });
      return;
    }

    if (pathname === "/menu") {
      void preloadBootAssets();
      preloadStoryShellAssets("normal");
      preloadMapAssets("normal");
      preloadBackgroundCatalog();

      const cachedSaves = queryClient.getQueryData<SaveSummary[]>(["saves"]);
      const latest = cachedSaves ? [...cachedSaves].sort(byNewest)[0] : undefined;
      if (latest) warmSaveEntry(queryClient, latest.id);
      return;
    }

    if (pathname === "/characters") {
      preloadCharacterWorkbenchAssets("high");
      preloadMapAssets("high");
      preloadBackgroundCatalog();
      return;
    }

    if (pathname.startsWith("/play/")) {
      preloadStoryShellAssets("high");
      preloadMapAssets("normal");
      preloadBackgroundCatalog();
      return;
    }

    preloadBackgroundCatalog();
  }, [pathname, queryClient]);
}

/** 剧情主界面局面级精准预载：按当前地点、在场人物、装备/义体/货架与绑定立绘插图高优插队 */
export function useStoryPreload(
  view: View | undefined,
  bindings: SaveImageBindings,
  queryClient: QueryClient,
): void {
  useEffect(() => {
    if (!view) return;

    const currentDistrict =
      view.names.district ?? view.travel.destinations.find((d) => d.here)?.district ?? null;

    const highAssets = new Set<AssetId>();
    const normalAssets = new Set<AssetId>();

    // 1. 当前地点背景最高优先解码；同城区与临近可前往目的地作为次优预载
    const activeBackdrop = backdropOf({
      location: view.location,
      locationName: view.names.location,
      district: currentDistrict,
      period: view.time.period,
    });
    void preloadAsset(activeBackdrop, "high", { decode: true });

    let extraBackdrops = 0;
    for (const dest of view.travel.destinations) {
      if (dest.here) continue;
      const sameDistrict = currentDistrict !== null && dest.district === currentDistrict;
      if (!sameDistrict && extraBackdrops >= 8) continue;
      const bg = backdropOf({
        location: dest.id,
        locationName: dest.name,
        district: dest.district,
        period: view.time.period,
      });
      if (bg !== activeBackdrop) {
        normalAssets.add(bg);
        if (!sameDistrict) extraBackdrops += 1;
      }
    }

    // 2. 在场 NPC 与通讯录联系人的原作头像
    for (const npc of view.npcs) {
      const portrait = portraitOf(npc.id);
      if (!portrait) continue;
      if (npc.here) highAssets.add(portrait);
      else if (npc.met) normalAssets.add(portrait);
    }

    const addGearArt = (bucket: Set<AssetId>, art: ReturnType<typeof itemArtOf>) => {
      if (art && !isCustomImageAssetId(art)) bucket.add(art);
    };

    // 3. 玩家当前装备、随身物品、已装义体与名下载具
    for (const weapon of view.inventory.carriedWeapons) {
      addGearArt(highAssets, itemArtOf(weapon.id));
    }
    if (view.inventory.healing) {
      addGearArt(highAssets, itemArtOf(view.inventory.healing.id));
    }
    if (view.inventory.grenade) {
      addGearArt(highAssets, itemArtOf(view.inventory.grenade.id));
    }
    for (const worn of view.inventory.clothing) {
      addGearArt(highAssets, itemArtOf(worn.id));
    }
    for (const itemId of Object.keys(view.inventory.backpack)) {
      addGearArt(normalAssets, itemArtOf(itemId));
    }
    for (const cw of view.cyberware) {
      addGearArt(highAssets, itemArtOf(cw.id));
    }
    for (const vehicle of view.travel.vehicles) {
      const art = vehicleArtOf(vehicle.model);
      if (art) highAssets.add(art);
    }

    // 4. 当前地点的义体医生与商店货架（点开终端即刻出图）
    if (view.ripperdoc) {
      preloadCharacterWorkbenchAssets("high");
      for (const item of view.ripperdoc.shelf) {
        addGearArt(normalAssets, itemArtOf(item.id));
      }
    }
    for (const shop of view.shops) {
      highAssets.add(shopPoiIconOf(shop.kind));
      for (const item of shop.shelf) {
        addGearArt(normalAssets, itemArtOf(item.id));
      }
    }

    void preloadAssets([...highAssets], "high", { decode: false });
    void preloadAssets([...normalAssets], "normal", { decode: false });
  }, [view]);

  // 5. 预热当前存档绑定的 AI 生成立绘与近期回合插图（从本地 IndexedDB 提前读入 Query 缓存）
  useEffect(() => {
    prefetchStoredImage(queryClient, bindings.playerPortrait);

    if (view) {
      for (const npc of view.npcs) {
        if (npc.here) prefetchStoredImage(queryClient, bindings.npcs[npc.id]);
      }
      const recentTurns = view.turns.slice(-4);
      for (const turn of recentTurns) {
        for (const imgId of turnImagesOf(bindings, turn.seq)) {
          prefetchStoredImage(queryClient, imgId);
        }
      }
    }
  }, [bindings, view, queryClient]);
}

/** 角色工作台预载：当前角色所选义体/武器/载具与本地角色库立绘缩略图 */
export function useCharactersPreload(
  card: CharacterCard,
  characters: readonly CharacterEntry[] | undefined,
  queryClient: QueryClient,
): void {
  useEffect(() => {
    const ids = new Set<AssetId>();
    const board = card.board;
    if (board) {
      if (board.tarot) {
        ids.add(`tarot.${board.tarot}`);
      }
      for (const cw of board.cyberware) {
        const art = itemArtOf(cw.id);
        if (art && !isCustomImageAssetId(art)) ids.add(art);
      }
      for (const weaponId of board.kit.weapons) {
        const art = itemArtOf(weaponId);
        if (art && !isCustomImageAssetId(art)) ids.add(art);
      }
      if (board.kit.vehicle) {
        const art = vehicleArtOf(board.kit.vehicle);
        if (art) ids.add(art);
      }
    }
    if (ids.size > 0) void preloadAssets([...ids], "high", { decode: false });
    prefetchStoredImage(queryClient, card.portrait);
  }, [card, queryClient]);

  useEffect(() => {
    if (!characters) return;
    for (const entry of characters.slice(0, 12)) {
      prefetchStoredImage(queryClient, entry.card.portrait);
    }
  }, [characters, queryClient]);
}
