// src/extension.ts
var activate = (context) => {
  context.registerExtensionUiContribution("responsive-preview-dual.view", {
    intents: {}
  });
};
export {
  activate
};
