import { createTypedCapabilities, type ExtensionActivate } from "@webflow/extension-sdk";
import type { Intents } from "./intents";

type ComposerCapabilityGrants = readonly ["preview.openRoute"];

export const activate: ExtensionActivate<Intents> = (ctx) => {
  const studio = createTypedCapabilities<ComposerCapabilityGrants>(ctx.capabilities);

  ctx.registerExtensionUiContribution("app-pages-directory.view", {
    intents: {
      "pages.openRoute": ({ params }) => studio["preview"]["openRoute"](params),
    },
  });
};
