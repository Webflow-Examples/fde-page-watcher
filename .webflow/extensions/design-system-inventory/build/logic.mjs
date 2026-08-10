// src/extension.ts
var activate = (context) => {
  context.registerExtensionUiContribution("design-system-inventory.view", {
    intents: {}
  });
};
export {
  activate
};
