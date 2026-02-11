/**
 * BRB (Be Right Back) state management
 * 
 * Tracks which threads/DM channels have users who are temporarily away.
 * State is ephemeral (in-memory) - if bot restarts, all users are assumed back.
 */

// In-memory storage of away thread IDs
const awayThreads = new Set<string>();

/**
 * Mark a thread as user-away
 */
export function setBrb(threadId: string): void {
  awayThreads.add(threadId);
}

/**
 * Mark a thread as user-returned
 */
export function setBack(threadId: string): void {
  awayThreads.delete(threadId);
}

/**
 * Check if user is away in a thread
 */
export function isAway(threadId: string): boolean {
  return awayThreads.has(threadId);
}

/**
 * Get all away threads (for diagnostics)
 */
export function getAwayThreads(): string[] {
  return Array.from(awayThreads);
}

/**
 * Check if message content indicates user is going away
 * Matches: 'brb', 'be right back', 'afk', 'stepping away'
 */
export function isBrbMessage(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  
  if (normalized === '') {
    return false;
  }
  
  const patterns = [
    'brb',
    'be right back',
    'afk',
    'stepping away',
  ];
  
  return patterns.includes(normalized);
}

/**
 * Check if message content indicates user is back
 * Matches: 'back', 'im back', "i'm back", 'here'
 */
export function isBackMessage(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  
  if (normalized === '') {
    return false;
  }
  
  const patterns = [
    'back',
    'im back',
    "i'm back",
    'here',
  ];
  
  return patterns.includes(normalized);
}
