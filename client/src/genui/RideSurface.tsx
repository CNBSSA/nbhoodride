import type { RideSurfaceSpec, GenUINode } from "@shared/genui/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface RideSurfaceProps {
  spec: RideSurfaceSpec;
  onAction?: (action: string) => void;
  className?: string;
}

function renderNode(node: GenUINode, onAction?: (action: string) => void, key?: string) {
  switch (node.type) {
    case "heading":
      return (
        <h3 key={key} className="text-base font-semibold text-foreground">
          {node.text}
        </h3>
      );
    case "text":
      return (
        <p
          key={key}
          className={cn("text-sm", node.variant === "muted" ? "text-muted-foreground" : "text-foreground")}
        >
          {node.text}
        </p>
      );
    case "metric":
      return (
        <div key={key} className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{node.label}</span>
          <span className="text-xl font-bold tabular-nums">{node.value}</span>
        </div>
      );
    case "badge":
      return (
        <Badge
          key={key}
          variant={node.tone === "warning" ? "destructive" : node.tone === "success" ? "default" : "secondary"}
        >
          {node.text}
        </Badge>
      );
    case "button":
      return (
        <Button
          key={key}
          type="button"
          size="sm"
          variant={node.variant === "destructive" ? "destructive" : node.variant === "secondary" ? "secondary" : "default"}
          onClick={() => onAction?.(node.action)}
          data-testid={`genui-action-${node.action}`}
        >
          {node.label}
        </Button>
      );
    case "row":
      return (
        <div key={key} className="flex flex-wrap items-center gap-3">
          {node.children.map((child, i) => renderNode(child, onAction, `${key}-c${i}`))}
        </div>
      );
    default:
      return null;
  }
}

/** Whitelisted GenUI renderer for ride surfaces (B1). */
export function RideSurface({ spec, onAction, className }: RideSurfaceProps) {
  return (
    <div className={cn("space-y-3", className)} data-testid="ride-surface">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{spec.title}</p>
      {spec.nodes.map((node, i) => renderNode(node, onAction, `n${i}`))}
    </div>
  );
}
