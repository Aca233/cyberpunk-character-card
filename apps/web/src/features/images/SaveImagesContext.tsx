import type { ImagePromptRequest } from "@cp/core";
import { createContext, useContext } from "react";
import type { SaveImageBindings } from "../../api/client";

export interface SaveImagesController {
  readonly saveId: string;
  readonly bindings: SaveImageBindings;
  readonly pendingTurnSeqs: ReadonlySet<number>;
  readonly openImageModal: (options: {
    readonly title: string;
    readonly subtitle?: string | undefined;
    readonly promptRequest: ImagePromptRequest;
    readonly defaultAspectRatio: "3:4" | "1:1" | "16:9";
    readonly bind:
      | { readonly kind: "turn"; readonly seq: number }
      | { readonly kind: "npc"; readonly npcId: string }
      | { readonly kind: "character" };
  }) => void;
  readonly unbindImage: (
    target:
      | { readonly kind: "turn"; readonly seq: number }
      | { readonly kind: "npc"; readonly npcId: string }
      | { readonly kind: "character" },
  ) => Promise<void>;
  readonly openLightbox: (imageId: string, title: string) => void;
  readonly cancelTurnAutoImage: (seq: number) => void;
}

const SaveImagesContext = createContext<SaveImagesController | null>(null);

export const SaveImagesProvider = SaveImagesContext.Provider;

export function useSaveImages(): SaveImagesController | null {
  return useContext(SaveImagesContext);
}
