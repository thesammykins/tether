export function generateThreadName(content: string): string {
  // Stub implementation - simple truncation
  // TODO: Implement smarter thread naming (e.g., extract topic, use LLM)
  if (content.length > 80) {
    return content.slice(0, 77) + '...';
  }
  return content || 'New conversation';
}
