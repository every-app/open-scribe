import { createServerFn } from "@tanstack/react-start";
import { ensureUserMiddleware } from "@every-app/sdk/tanstack-start";
import { z } from "zod";
import * as templates from "@/server/templates";

const idInput = z.object({ id: z.string().uuid() }).strict();

/** Every template the person may use, and which one is their default. */
export const listTemplates = createServerFn()
  .middleware([ensureUserMiddleware])
  .handler(async ({ context: { user } }) => ({
    templates: await templates.listTemplates(user),
    defaultTemplateId: await templates.getDefaultTemplateId(user),
  }));

export const setDefaultTemplate = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) =>
    z.object({ templateId: templates.templateIdInput }).strict().parse(data),
  )
  .handler(async ({ data, context: { user } }) => {
    if (!(await templates.setDefaultTemplateId(user, data.templateId))) {
      throw new Error("No template with that id.");
    }
  });

export const createTemplate = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => templates.saveTemplateInput.parse(data))
  .handler(({ data, context: { user } }) =>
    templates.createTemplate(user, data),
  );

export const updateTemplate = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) =>
    idInput.extend({ change: templates.saveTemplateInput }).parse(data),
  )
  .handler(async ({ data, context: { user } }) => {
    const template = await templates.updateTemplate(user, data.id, data.change);
    if (!template) throw new Error("Only its owner can edit a template.");
    return template;
  });

export const deleteTemplate = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => idInput.parse(data))
  .handler(({ data, context: { user } }) =>
    templates.deleteTemplate(user, data.id),
  );
