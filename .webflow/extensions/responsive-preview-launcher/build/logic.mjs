// src/extension.ts
var activate = (context) => {
  context.registerExtensionUiContribution("responsive-preview-launcher.view", {
    intents: {}
  });
};
export {
  activate
};
