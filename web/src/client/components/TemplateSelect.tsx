import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/client/components/ui/select";
import type { Template } from "@/api/contract";

const AUTO = "__auto";

/**
 * Pick a template. `autoLabel` offers "no choice here" (null), so the next
 * rule decides: a folder's default, then each person's own.
 */
export function TemplateSelect({
  templates,
  value,
  autoLabel,
  onChange,
  disabled,
  className,
}: {
  templates: Template[];
  value: string | null;
  autoLabel?: string;
  onChange: (templateId: string | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  const items = [
    ...(autoLabel ? [{ value: AUTO, label: autoLabel }] : []),
    ...templates.map((template) => ({
      value: template.id,
      label: template.name,
    })),
  ];
  const current = value ?? (autoLabel ? AUTO : null);
  return (
    <Select
      items={items}
      value={current}
      disabled={disabled}
      onValueChange={(next) => {
        if (next === null || next === current) return;
        onChange(next === AUTO ? null : next);
      }}
    >
      <SelectTrigger size="sm" className={className ?? "w-56"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
