import type { Component } from "./types.js";
import { openPicker } from "./open-picker.js";

// Register new components here.
export const componentList: Component[] = [openPicker];

export const components = new Map<string, Component>(
  componentList.map((component) => [component.id, component]),
);
