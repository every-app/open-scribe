import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@talk/ui/components/button";
import { takeNotesLink } from "@/client/lib/talk-link";

/** Starts notes now in Talk for Mac. */
export function NewNoteButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      nativeButton={false}
      render={<a href={takeNotesLink()} />}
      onClick={() =>
        toast("Opening Talk for Mac…", {
          description: "Nothing happened? Set up the Mac app in Settings.",
        })
      }
    >
      <Plus />
      New note
    </Button>
  );
}
