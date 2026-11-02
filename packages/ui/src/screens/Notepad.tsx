import { cn } from "cn";
import { useLayoutEffect, useRef } from "react";
import { markdownShortcut } from "../lib/markdown-shortcuts";

/**
 * The notepad: plain Markdown in a calm, auto-growing textarea, with list
 * and bold/italic shortcuts. Controlled; the caller saves.
 */
export function Notepad({
  value,
  onChange,
  placeholder = "Write notes…",
  autoFocus,
  readOnly,
  className,
  label = "Notes",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  readOnly?: boolean;
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the text so the page, not the box, scrolls.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      data-slot="notepad"
      aria-label={label}
      value={value}
      readOnly={readOnly}
      autoFocus={autoFocus}
      placeholder={placeholder}
      spellCheck
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (readOnly) return;
        const el = event.currentTarget;
        const edit = markdownShortcut(
          el.value,
          el.selectionStart,
          el.selectionEnd,
          {
            key: event.key,
            shift: event.shiftKey,
            meta: event.metaKey || event.ctrlKey,
          },
        );
        if (!edit) return;
        event.preventDefault();
        el.setSelectionRange(edit.from, edit.to);
        // insertText keeps the browser's undo stack; fall back if it's gone.
        const inserted =
          typeof document.execCommand === "function" &&
          document.execCommand("insertText", false, edit.text);
        if (!inserted) {
          el.setRangeText(edit.text, edit.from, edit.to, "end");
          onChange(el.value);
        }
        el.setSelectionRange(edit.selStart, edit.selEnd);
      }}
      className={cn(
        "block w-full resize-none overflow-hidden bg-transparent text-[15px] leading-[1.7] text-foreground outline-none placeholder:text-muted-foreground/70",
        className,
      )}
    />
  );
}
