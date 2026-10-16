import type { Modal } from "./types.js";
import { sessionBuilder } from "./session-builder.js";

// Register new modals here.
export const modalList: Modal[] = [sessionBuilder];

export const modals = new Map<string, Modal>(modalList.map((modal) => [modal.id, modal]));
