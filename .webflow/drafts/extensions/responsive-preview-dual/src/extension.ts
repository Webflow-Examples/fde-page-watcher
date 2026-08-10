import type { ExtensionActivate } from "@webflow/extension-sdk";
import type { Intents } from "./intents";

export const activate: ExtensionActivate<Intents> = (context) => {
  context.registerExtensionUiContribution("responsive-preview-dual.view", {
    intents: {},
  });
};
