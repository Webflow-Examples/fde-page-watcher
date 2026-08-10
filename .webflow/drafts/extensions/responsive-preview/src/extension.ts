import type { ExtensionActivate } from "@webflow/extension-sdk";
import type { Intents } from "./intents";

export const activate: ExtensionActivate<Intents> = (context) => {
  context.registerExtensionUiContribution("responsive-preview.view", {
    intents: {
      "responsive-preview.echo": ({ params }) => ({
        status: "ok",
        data: { message: params.message },
      }),
    },
  });
};
