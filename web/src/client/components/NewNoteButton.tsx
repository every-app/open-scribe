import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@talk/ui/components/button";
import { takeNotesLink } from "@/client/lib/mac-app-link";

/** Starts notes now in the Mac app. */
export function NewNoteButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      nativeButton={false}
      render={<a href={takeNotesLink()} />}
      onClick={() =>
        toast("Opening the Mac app…", {
          description: "Nothing happened? Set up the Mac app in Settings.",
        })
      }
    >
      <Plus />
      New note
    </Button>
  );
}
