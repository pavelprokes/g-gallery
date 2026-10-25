import "server-only";
import type { McpTool } from "../types";
import { ACTIVITY_READ_TOOLS } from "./activity";
import { GALLERY_READ_TOOLS } from "./galleries";
import { PHOTO_READ_TOOLS } from "./photos";
import { WEDDING_READ_TOOLS } from "./weddings";
import { WRITE_TOOLS } from "./write";

export const ALL_TOOLS: readonly McpTool[] = [
  ...GALLERY_READ_TOOLS,
  ...WEDDING_READ_TOOLS,
  ...PHOTO_READ_TOOLS,
  ...ACTIVITY_READ_TOOLS,
  ...WRITE_TOOLS,
];
