import type { ImagePromptRequest } from "@cp/core";
import { createContext, useContext } from "react";
import type { SaveImageBindings, SaveImageUnbindTarget } from "../../api/client";
import type { ImageTarget } from "./image-jobs";

export interface SaveImagesController {
  readonly saveId: string;
  readonly bindings: SaveImageBindings;
  readonly pendingTurnSeqs: ReadonlySet<number>;
  readonly manualPendingTurnSeqs: ReadonlySet<number>;
  readonly turnImageProgress: Readonly<
    Record<number, { readonly current: number; readonly total: number }>
  >;
  readonly turnImageErrors: Readonly<Record<number, string>>;
  readonly openImageModal: (options: {
    readonly title: string;
    readonly subtitle?: string | undefined;
    readonly promptRequest: ImagePromptRequest;
    readonly defaultAspectRatio: "3:4" | "1:1" | "16:9";
    readonly bind: ImageTarget;
  }) => void;
  readonly unbindImage: (target: SaveImageUnbindTarget) => Promise<void>;
  readonly openLightbox: (
    imageId: string,
    title: string,
    options?: { readonly onReplace?: () => void; readonly replaceLabel?: string },
  ) => void;
  readonly cancelTurnAutoImage: (seq: number) => void;
}

const SaveImagesContext = createContext<SaveImagesController | null>(null);

export const SaveImagesProvider = SaveImagesContext.Provider;

export function useSaveImages(): SaveImagesController | null {
  return useContext(SaveImagesContext);
}
