import type { Component } from "./types.js";
import { openPicker } from "./open-picker.js";
import { sessionButtons } from "./session.js";
import { sessionTime } from "./session-time.js";

// Register new components here.
export const componentList: Component[] = [openPicker, sessionTime, sessionButtons];

export const components = new Map<string, Component>(
  componentList.map((component) => [component.id, component]),
);
