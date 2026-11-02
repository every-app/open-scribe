import { createServerFn } from "@tanstack/react-start";
import { ensureUserMiddleware } from "@every-app/sdk/tanstack-start";
import { z } from "zod";
import { createFolderInput, updateFolderInput } from "@/api/contract";
import * as folders from "@/server/folders";

const idInput = z.object({ id: z.string().uuid() }).strict();
const filingInput = z
  .object({ folderId: z.string().uuid(), meetingId: z.string().uuid() })
  .strict();

export const listFolders = createServerFn()
  .middleware([ensureUserMiddleware])
  .handler(({ context: { user } }) => folders.listFolders(user));

export const getFolder = createServerFn()
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => idInput.parse(data))
  .handler(({ data, context: { user } }) => folders.getFolder(user, data.id));

export const createFolder = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => createFolderInput.parse(data))
  .handler(({ data, context: { user } }) => folders.createFolder(user, data));

export const updateFolder = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) =>
    idInput.extend({ change: updateFolderInput }).parse(data),
  )
  .handler(async ({ data, context: { user } }) => {
    const folder = await folders.updateFolder(user, data.id, data.change);
    if (!folder) throw new Error("You can't change this folder.");
    return folder;
  });

export const deleteFolder = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => idInput.parse(data))
  .handler(({ data, context: { user } }) =>
    folders.deleteFolder(user, data.id),
  );

export const addToFolder = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => filingInput.parse(data))
  .handler(async ({ data, context: { user } }) => {
    const added = await folders.addToFolder(
      user,
      data.folderId,
      data.meetingId,
    );
    if (!added) {
      throw new Error(
        "Only its owner can add a private meeting to a team folder.",
      );
    }
    return added;
  });

export const removeFromFolder = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware])
  .validator((data: unknown) => filingInput.parse(data))
  .handler(({ data, context: { user } }) =>
    folders.removeFromFolder(user, data.folderId, data.meetingId),
  );
