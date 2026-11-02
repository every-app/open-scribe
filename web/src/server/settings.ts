import type { z } from "zod";
import type { Settings, updateSettingsInput } from "@/api/contract";
import { getDefaultTemplateId, setDefaultTemplateId } from "./templates";
import type { Viewer } from "./viewer";

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
