import { createTypedCapabilities, type ExtensionActivate } from "@webflow/extension-sdk";
import type { Intents } from "./intents";

type ComposerCapabilityGrants = readonly ["preview.openTarget","preview.openRoute"];

export const activate: ExtensionActivate<Intents> = (ctx) => {
  const studio = createTypedCapabilities<ComposerCapabilityGrants>(ctx.capabilities);

  ctx.registerExtensionUiContribution("sitemap-node-graph.view", {
    intents: {
      "preview.openTarget": ({ params }) => studio["preview"]["openTarget"](...(params === undefined ? [] : [params])),
      "preview.openRoute": ({ params }) => studio["preview"]["openRoute"](params),
    },
  });
};
