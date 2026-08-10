// This View renders a fixed local snapshot only; it does not call any
// Studio capability or extension-logic intent. The map is kept empty
// (rather than deleted) because the managed View scaffold always wires
// WebflowExtensionView.connect<Intents>() against this shared contract.
export type Intents = Record<string, never>;
