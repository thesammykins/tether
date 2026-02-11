const MAX_THREAD_NAME_LENGTH = 80;

export function generateThreadName(content: string): string {
  if (!content || content.trim().length === 0) {
    return 'New conversation';
  }
  
  let name = content.trim();
  
  // Strip markdown formatting
  name = name.replace(/[*_~`#]/g, '');
  
  // Use first line only
  const firstLine = name.split('\n')[0].trim();
  name = firstLine || name;
  
  // If short enough, return as-is
  if (name.length <= MAX_THREAD_NAME_LENGTH) {
    return name;
  }
  
  // Truncate at word boundary
  const truncated = name.slice(0, MAX_THREAD_NAME_LENGTH - 1); // -1 for ellipsis char
  const lastSpace = truncated.lastIndexOf(' ');
  
  if (lastSpace > MAX_THREAD_NAME_LENGTH * 0.5) {
    // Break at word boundary if it doesn't lose too much
    return truncated.slice(0, lastSpace) + '…';
  }
  
  // Hard truncate if no good word boundary
  return truncated + '…';
}
