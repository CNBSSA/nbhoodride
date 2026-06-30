import { z } from "zod";

/** Whitelisted GenUI nodes — no arbitrary HTML. */
export const genUiNodeSchema: z.ZodType<GenUINode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("heading"), text: z.string().max(200) }),
    z.object({
      type: z.literal("text"),
      text: z.string().max(500),
      variant: z.enum(["default", "muted"]).optional(),
    }),
    z.object({ type: z.literal("metric"), label: z.string().max(80), value: z.string().max(80) }),
    z.object({
      type: z.literal("button"),
      action: z.string().max(80),
      label: z.string().max(80),
      variant: z.enum(["primary", "secondary", "destructive"]).optional(),
    }),
    z.object({ type: z.literal("badge"), text: z.string().max(60), tone: z.enum(["info", "success", "warning"]) }),
    z.object({ type: z.literal("row"), children: z.array(genUiNodeSchema).max(6) }),
  ]),
);

export type GenUINode =
  | { type: "heading"; text: string }
  | { type: "text"; text: string; variant?: "default" | "muted" }
  | { type: "metric"; label: string; value: string }
  | { type: "button"; action: string; label: string; variant?: "primary" | "secondary" | "destructive" }
  | { type: "badge"; text: string; tone: "info" | "success" | "warning" }
  | { type: "row"; children: GenUINode[] };

export const rideSurfaceSpecSchema = z.object({
  version: z.literal(1),
  title: z.string().max(120),
  nodes: z.array(genUiNodeSchema).max(24),
});

export type RideSurfaceSpec = z.infer<typeof rideSurfaceSpecSchema>;

export const mobilityIntentTypeSchema = z.enum([
  "ride_home",
  "ride_to",
  "repeat_last",
  "book_ride",
  "guardian_share",
  "unknown",
]);

export type MobilityIntentType = z.infer<typeof mobilityIntentTypeSchema>;

export interface ParsedMobilityIntent {
  intentType: MobilityIntentType;
  confidence: number;
  destinationAddress?: string;
  label: string;
  utterance: string;
}

export const AUTONOMY_LEVELS = [
  { level: 0, label: "Suggest", description: "Show intent cards only" },
  { level: 1, label: "Pre-fill", description: "Fill booking form; you confirm" },
  { level: 2, label: "Smart match", description: "Pick best driver; you confirm" },
  { level: 3, label: "Auto-book", description: "Book repeat trips automatically" },
] as const;
