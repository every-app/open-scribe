import { z } from "zod";
import {
  getDefaultTemplateId,
  setDefaultTemplateId,
  templateIdInput,
} from "./templates";
import type { Viewer } from "./viewer";

/**
 * The person's settings that live on the server. Light/dark is a choice
 * of each device (the web keeps it in localStorage), so it isn't here.
 */
export interface Settings {
  defaultTemplateId: string;
}

export const updateSettingsInput = z
  .object({ defaultTemplateId: templateIdInput.optional() })
  .strict();

export async function getSettings(viewer: Viewer): Promise<Settings> {
  return { defaultTemplateId: await getDefaultTemplateId(viewer) };
}

/** Null when a value isn't allowed (a template the person may not use). */
export async function updateSettings(
  viewer: Viewer,
  change: z.infer<typeof updateSettingsInput>,
): Promise<Settings | null> {
  if (
    change.defaultTemplateId &&
    !(await setDefaultTemplateId(viewer, change.defaultTemplateId))
  ) {
    return null;
  }
  return getSettings(viewer);
}
