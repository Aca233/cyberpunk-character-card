import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { api, type SaveImageBindings, type StoredImage, turnImagesOf } from "../../api/client";

export type ImageTarget =
  | {
      readonly kind: "turn";
      readonly seq: number;
      /** 重绘指定插图槽位（0-based） */
      readonly slot?: number | undefined;
      /** 在该轮末尾追加新插图 */
      readonly append?: boolean | undefined;
      /** 整轮覆盖为单图 */
      readonly replaceAll?: boolean | undefined;
    }
  | { readonly kind: "npc"; readonly npcId: string }
  | { readonly kind: "character" };

export interface ImageJobBinding {
  readonly saveId: string;
  readonly target: ImageTarget;
}

export interface ImageJob {
  readonly key: string;
  readonly attempt: number;
  readonly sourceKey: string;
  readonly binding?: ImageJobBinding;
  readonly status: "generating" | "applying" | "done" | "error" | "cancelled";
  readonly image?: StoredImage;
  readonly images?: readonly StoredImage[];
  readonly progress?: { readonly current: number; readonly total: number };
  readonly error?: string;
}

let jobs: readonly ImageJob[] = [];
let nextAttempt = 0;
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function imageTargetKey(binding: ImageJobBinding): string {
  const target = binding.target;
  if (target.kind === "turn") {
    const mode = target.append
      ? "append"
      : target.slot !== undefined
        ? `slot:${target.slot}`
        : "turn";
    return JSON.stringify([binding.saveId, target.kind, target.seq, mode]);
  }
  return JSON.stringify([binding.saveId, target.kind, target.kind === "npc" ? target.npcId : null]);
}

export function getImageJob(key: string): ImageJob | undefined {
  return jobs.find((job) => job.key === key);
}

export function isImageJobPending(job: ImageJob | undefined): boolean {
  return job?.status === "generating" || job?.status === "applying";
}

export function useImageJobs(): readonly ImageJob[] {
  return useSyncExternalStore(subscribe, () => jobs);
}

export function useImageJob(key: string): ImageJob | undefined {
  return useSyncExternalStore(subscribe, () => getImageJob(key));
}

function publish(job: ImageJob): void {
  const others = jobs.filter((item) => item.key !== job.key);
  jobs = [
    job,
    ...others.filter(isImageJobPending),
    ...others.filter((item) => !isImageJobPending(item)).slice(0, 29),
  ];
  for (const listener of listeners) listener();
}

export function cancelImageJob(key: string): void {
  const job = getImageJob(key);
  if (!job || !isImageJobPending(job)) return;
  controllers.get(key)?.abort();
  controllers.delete(key);
  publish({ ...job, status: "cancelled" });
}

export function cancelTurnImageJobs(saveId: string, seq: number): void {
  for (const job of jobs) {
    if (
      isImageJobPending(job) &&
      job.binding?.saveId === saveId &&
      job.binding.target.kind === "turn" &&
      job.binding.target.seq === seq
    ) {
      cancelImageJob(job.key);
    }
  }
}

export function boundImage(bindings: SaveImageBindings, target: ImageTarget): string | null {
  if (target.kind === "turn") {
    if (target.append) return null;
    const list = turnImagesOf(bindings, target.seq);
    if (target.slot !== undefined) return list[target.slot] ?? null;
    return list[0] ?? null;
  }
  if (target.kind === "npc") return bindings.npcs[target.npcId] ?? null;
  return bindings.playerPortrait ?? null;
}

/** 生成任务属于冻结的目标；面板关闭或页面组件卸载都不会取消它。 */
export function startImageJob(input: {
  readonly key: string;
  readonly sourceKey: string;
  readonly request: Parameters<typeof api.generateImage>[0];
  readonly binding?: ImageJobBinding;
  readonly client: QueryClient;
}): void {
  if (isImageJobPending(getImageJob(input.key))) return;
  const request = structuredClone(input.request);
  const binding = input.binding ? structuredClone(input.binding) : undefined;
  const controller = new AbortController();
  const attempt = ++nextAttempt;
  const initial: ImageJob = {
    key: input.key,
    attempt,
    sourceKey: input.sourceKey,
    ...(binding ? { binding } : {}),
    status: "generating",
  };
  controllers.set(input.key, controller);
  publish(initial);
  const current = () => !controller.signal.aborted && getImageJob(input.key)?.attempt === attempt;
  void (async () => {
    let image: StoredImage | undefined;
    let applying = false;
    try {
      // 请求前固定原选择，后续手动换图或其他任务完成都不能被这个结果覆盖；追加模式不校验 expectedImageId。
      const expectedImageId =
        binding && !(binding.target.kind === "turn" && binding.target.append)
          ? boundImage(await api.saveImages(binding.saveId), binding.target)
          : undefined;
      if (!current()) return;
      const generated = await api.generateImage(request, controller.signal);
      if (!current()) return;
      image = generated.image;
      input.client.setQueryData(["image", image.id], image);
      if (binding) {
        applying = true;
        publish({ ...initial, status: "applying", image, images: [image] });
        const bindings = await api.bindSaveImage(
          binding.saveId,
          {
            ...binding.target,
            imageId: image.id,
            ...(expectedImageId !== undefined ? { expectedImageId } : {}),
          },
          controller.signal,
        );
        if (!current()) {
          void input.client.invalidateQueries({
            queryKey: ["saveImages", binding.saveId],
            exact: true,
          });
          return;
        }
        input.client.setQueryData(["saveImages", binding.saveId], bindings);
      }
      if (current()) publish({ ...initial, status: "done", image, images: [image] });
    } catch (error) {
      if (applying && binding) {
        void input.client.invalidateQueries({
          queryKey: ["saveImages", binding.saveId],
          exact: true,
        });
      }
      if (current()) {
        const message = error instanceof Error ? error.message : String(error);
        publish({
          ...initial,
          status: "error",
          ...(image ? { image, images: [image] } : {}),
          error: image ? `图片已保存，但未采用：${message}` : message,
        });
      }
    } finally {
      if (controllers.get(input.key) === controller) controllers.delete(input.key);
    }
  })();
}

/** 单轮正文多图任务：按顺序生成多个分镜，逐张实时绑定到该轮正文对应槽位，关闭面板后继续在后台跑完 */
export function startMultiTurnImageJob(input: {
  readonly key: string;
  readonly sourceKey: string;
  readonly requests: readonly Parameters<typeof api.generateImage>[0][];
  readonly binding: {
    readonly saveId: string;
    readonly seq: number;
    /** true 表示在已有插图后追加；false 表示从槽位 0 开始重建本轮插图 */
    readonly append?: boolean;
  };
  readonly client: QueryClient;
}): void {
  if (input.requests.length === 0 || isImageJobPending(getImageJob(input.key))) return;
  const requests = input.requests.map((r) => structuredClone(r));
  const binding: ImageJobBinding = {
    saveId: input.binding.saveId,
    target: {
      kind: "turn",
      seq: input.binding.seq,
      ...(input.binding.append ? { append: true } : {}),
    },
  };
  const controller = new AbortController();
  const attempt = ++nextAttempt;
  const total = requests.length;
  const initial: ImageJob = {
    key: input.key,
    attempt,
    sourceKey: input.sourceKey,
    binding,
    status: "generating",
    images: [],
    progress: { current: 1, total },
  };
  controllers.set(input.key, controller);
  publish(initial);
  const current = () => !controller.signal.aborted && getImageJob(input.key)?.attempt === attempt;

  void (async () => {
    const generatedList: StoredImage[] = [];
    let applying = false;
    try {
      for (let i = 0; i < requests.length; i++) {
        if (!current()) return;
        const latest = generatedList.at(-1);
        publish({
          ...initial,
          status: "generating",
          ...(latest ? { image: latest } : {}),
          images: [...generatedList],
          progress: { current: i + 1, total },
        });
        const req = requests[i];
        if (!req) continue;
        const generated = await api.generateImage(req, controller.signal);
        if (!current()) return;
        const img = generated.image;
        generatedList.push(img);
        input.client.setQueryData(["image", img.id], img);

        applying = true;
        publish({
          ...initial,
          status: "applying",
          image: img,
          images: [...generatedList],
          progress: { current: i + 1, total },
        });
        const nextBindings = await api.bindSaveImage(
          input.binding.saveId,
          {
            kind: "turn",
            seq: input.binding.seq,
            imageId: img.id,
            ...(input.binding.append
              ? { append: true }
              : i === 0
                ? { replaceAll: true }
                : { append: true }),
          },
          controller.signal,
        );
        applying = false;
        if (!current()) {
          void input.client.invalidateQueries({
            queryKey: ["saveImages", input.binding.saveId],
            exact: true,
          });
          return;
        }
        input.client.setQueryData(["saveImages", input.binding.saveId], nextBindings);
      }
      if (current()) {
        const first = generatedList[0];
        publish({
          ...initial,
          status: "done",
          ...(first ? { image: first } : {}),
          images: [...generatedList],
          progress: { current: total, total },
        });
      }
    } catch (error) {
      if (applying) {
        void input.client.invalidateQueries({
          queryKey: ["saveImages", input.binding.saveId],
          exact: true,
        });
      }
      if (current()) {
        const message = error instanceof Error ? error.message : String(error);
        const latest = generatedList.at(-1);
        publish({
          ...initial,
          status: "error",
          ...(latest ? { image: latest } : {}),
          images: [...generatedList],
          progress: { current: Math.max(1, generatedList.length), total },
          error:
            generatedList.length > 0
              ? `已生成 ${generatedList.length}/${total} 张，后续中断：${message}`
              : message,
        });
      }
    } finally {
      if (controllers.get(input.key) === controller) controllers.delete(input.key);
    }
  })();
}
