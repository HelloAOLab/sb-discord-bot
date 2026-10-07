import type { Component } from "./types.js";
import { openPicker } from "./open-picker.js";
import { pingAgain } from "./ping-again.js";

// Register new components here.
export const componentList: Component[] = [pingAgain, openPicker];

export const components = new Map<string, Component>(
  componentList.map((component) => [component.id, component]),
);
