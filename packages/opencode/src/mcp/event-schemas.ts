/**
 * MCP Event Zod schemas for the events/emit notification and events/subscribe result.
 *
 * These mirror the schemas from @modelcontextprotocol/sdk (typescript-sdk elijahr/mcp-events branch).
 * Once the SDK is published with event support, these can be replaced with direct imports.
 */
import z from "zod/v4"

export const EventEffectSchema = z.object({
  type: z.enum(["inject_context", "notify_user", "trigger_turn"]),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional().default("normal"),
})

export const EventParamsSchema = z.object({
  _meta: z.record(z.string(), z.unknown()).optional(),
  topic: z.string(),
  event_id: z.string(),
  payload: z.unknown(),
  timestamp: z.string().optional(),
  retained: z.boolean().optional(),
  source: z.string().optional(),
  correlation_id: z.string().optional(),
  requested_effects: z.array(EventEffectSchema).optional(),
  expires_at: z.string().optional(),
})

export const EventEmitNotificationSchema = z.object({
  method: z.literal("events/emit"),
  params: EventParamsSchema,
})

export const SubscribedTopicSchema = z.object({
  pattern: z.string(),
})

export const RejectedTopicSchema = z.object({
  pattern: z.string(),
  reason: z.string(),
})

export const RetainedEventSchema = z.object({
  topic: z.string(),
  event_id: z.string(),
  timestamp: z.string().optional(),
  payload: z.unknown(),
})

export const EventSubscribeResultSchema = z.object({
  _meta: z.record(z.string(), z.unknown()).optional(),
  subscribed: z.array(SubscribedTopicSchema),
  rejected: z.array(RejectedTopicSchema).optional().default([]),
  retained: z.array(RetainedEventSchema).optional().default([]),
})

export const EventTopicDescriptorSchema = z.object({
  pattern: z.string(),
  description: z.string().optional(),
  retained: z.boolean().optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
})
