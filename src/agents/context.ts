/**
 * Custom run context passed into every agent run. Tools (like
 * create_task) read this to know which user/conversation they're acting
 * on, instead of hardcoding it.
 */
export interface AgentRunContext {
  userId: string;
  conversationId: string;
}
