import type { ExtensionActivate } from "@webflow/extension-sdk";
import type { Intents } from "./intents";

// No intents are registered: this View renders only the fixed local
// snapshot built into the bundle and never calls back into extension logic.
export const activate: ExtensionActivate<Intents> = (context) => {
  context.registerExtensionUiContribution("design-system-inventory.view", {
    intents: {},
  });
};
