import { createFileRoute, useRouter } from "@tanstack/react-router";
import { LayoutTemplate, MoreHorizontal, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Page, PageTitle } from "@/client/components/Page";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import { Textarea } from "@/client/components/ui/textarea";
import type { Template } from "@/server/templates";
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  setDefaultTemplate,
  updateTemplate,
} from "@/serverFunctions/templates";

export const Route = createFileRoute("/_app/templates")({
  loader: () => listTemplates(),
  head: () => ({ meta: [{ title: "Templates · Talk" }] }),
  component: Templates,
});

/** What the editor opens with: a template to edit, or a draft to create. */
type Editing =
  | { mode: "edit"; template: Template }
  | { mode: "create"; draft: Pick<Template, "name" | "instructions"> };

function Templates() {
  const { templates, defaultTemplateId } = Route.useLoaderData();
  const router = useRouter();
  const [editing, setEditing] = useState<Editing | null>(null);

  async function run(work: () => Promise<unknown>, failed: string) {
    try {
      await work();
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : failed);
    }
  }

  return (
    <Page>
      <PageTitle
        description="A template decides how notes are written: the sections, the detail, what to pull out. Pick one per meeting, per folder, or as your default."
        actions={
          <Button
            size="sm"
            onClick={() =>
              setEditing({
                mode: "create",
                draft: { name: "", instructions: "" },
              })
            }
          >
            <Plus />
            New template
          </Button>
        }
      >
        Templates
      </PageTitle>

      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
        {templates.map((template) => (
          <li key={template.id} className="flex items-center gap-3 px-4 py-3">
            <LayoutTemplate className="size-4 shrink-0 text-muted-foreground" />
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() =>
                template.mine
                  ? setEditing({ mode: "edit", template })
                  : setEditing({
                      mode: "create",
                      draft: {
                        name: `${template.name} (copy)`,
                        instructions: template.instructions,
                      },
                    })
              }
            >
              <span className="block truncate font-medium">
                {template.name}
              </span>
              <span className="block truncate text-sm text-muted-foreground">
                {template.instructions}
              </span>
            </button>
            {template.id === defaultTemplateId && <Badge>Default</Badge>}
            {!template.builtIn && template.visibility === "team" && (
              <Badge variant="secondary">Team</Badge>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${template.name} actions`}
                  />
                }
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                {template.id !== defaultTemplateId && (
                  <DropdownMenuItem
                    onClick={() =>
                      run(
                        () =>
                          setDefaultTemplate({
                            data: { templateId: template.id },
                          }),
                        "Couldn't set the default.",
                      )
                    }
                  >
                    Make my default
                  </DropdownMenuItem>
                )}
                {template.mine && (
                  <DropdownMenuItem
                    onClick={() => setEditing({ mode: "edit", template })}
                  >
                    Edit
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() =>
                    setEditing({
                      mode: "create",
                      draft: {
                        name: `${template.name} (copy)`,
                        instructions: template.instructions,
                      },
                    })
                  }
                >
                  Duplicate
                </DropdownMenuItem>
                {template.mine && (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() =>
                      run(
                        () => deleteTemplate({ data: { id: template.id } }),
                        "Couldn't delete it.",
                      )
                    }
                  >
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>

      <TemplateEditor
        editing={editing}
        onClose={() => setEditing(null)}
        onSave={async (values) => {
          if (!editing) return;
          await run(
            () =>
              editing.mode === "edit"
                ? updateTemplate({
                    data: { id: editing.template.id, change: values },
                  })
                : createTemplate({ data: values }),
            "Couldn't save the template.",
          );
          setEditing(null);
        }}
      />
    </Page>
  );
}

const VISIBILITY_ITEMS = [
  { value: "private", label: "Only me" },
  { value: "team", label: "Everyone on the team" },
];

function TemplateEditor({
  editing,
  onClose,
  onSave,
}: {
  editing: Editing | null;
  onClose: () => void;
  onSave: (values: {
    name: string;
    instructions: string;
    visibility: "private" | "team";
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [visibility, setVisibility] = useState<"private" | "team">("private");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!editing) return;
    const source = editing.mode === "edit" ? editing.template : editing.draft;
    setName(source.name);
    setInstructions(source.instructions);
    setVisibility(
      editing.mode === "edit" ? editing.template.visibility : "private",
    );
  }, [editing]);

  const valid = name.trim() && instructions.trim();
  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!valid) return;
            setPending(true);
            try {
              await onSave({
                name: name.trim(),
                instructions: instructions.trim(),
                visibility,
              });
            } finally {
              setPending(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {editing?.mode === "edit" ? "Edit template" : "New template"}
            </DialogTitle>
            <DialogDescription>
              Say which sections to write and what goes in each, in plain words.
              The notes follow it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-name">Name</Label>
            <Input
              id="template-name"
              autoFocus
              placeholder="Sales discovery call"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-instructions">Instructions</Label>
            <Textarea
              id="template-instructions"
              rows={8}
              placeholder={`Sections, in order: "## Their goals", "## Budget and timeline", "## Next steps" (bullets as "- [ ] owner: task").`}
              value={instructions}
              maxLength={4000}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Who can use it</Label>
            <Select
              items={VISIBILITY_ITEMS}
              value={visibility}
              onValueChange={(next) => {
                if (next === "private" || next === "team") setVisibility(next);
              }}
            >
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VISIBILITY_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
