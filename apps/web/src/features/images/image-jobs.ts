import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { api, type SaveImageBindings, type StoredImage } from "../../api/client";

export type ImageTarget =
  | { readonly kind: "turn"; readonly seq: number }
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
  return JSON.stringify([
    binding.saveId,
    target.kind,
    target.kind === "turn" ? target.seq : target.kind === "npc" ? target.npcId : null,
  ]);
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

export function boundImage(bindings: SaveImageBindings, target: ImageTarget): string | null {
  if (target.kind === "turn") return bindings.turns[String(target.seq)] ?? null;
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
      // 请求前固定原选择，后续手动换图或其他任务完成都不能被这个结果覆盖。
      const expectedImageId = binding
        ? boundImage(await api.saveImages(binding.saveId), binding.target)
        : null;
      if (!current()) return;
      const generated = await api.generateImage(request, controller.signal);
      if (!current()) return;
      image = generated.image;
      input.client.setQueryData(["image", image.id], image);
      if (binding) {
        applying = true;
        publish({ ...initial, status: "applying", image });
        const bindings = await api.bindSaveImage(
          binding.saveId,
          { ...binding.target, imageId: image.id, expectedImageId },
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
      if (current()) publish({ ...initial, status: "done", image });
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
          ...(image ? { image } : {}),
          error: image ? `图片已保存，但未采用：${message}` : message,
        });
      }
    } finally {
      if (controllers.get(input.key) === controller) controllers.delete(input.key);
    }
  })();
}
