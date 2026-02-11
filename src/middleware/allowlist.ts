import { ChannelType, type Message } from 'discord.js';

/**
 * Parse comma-separated environment variable into Set.
 * Returns null if not configured (no restriction).
 */
function parseEnvList(value?: string): Set<string> | null {
  if (!value || value.trim() === '') return null;
  return new Set(value.split(',').map(s => s.trim()).filter(Boolean));
}

// Parse env vars once at module load
const ALLOWED_USERS = parseEnvList(process.env.ALLOWED_USERS);
const ALLOWED_ROLES = parseEnvList(process.env.ALLOWED_ROLES);
const ALLOWED_CHANNELS = parseEnvList(process.env.ALLOWED_CHANNELS);

/**
 * Check if message is from an allowed user/role/channel.
 * 
 * Guild messages:
 * - If ALLOWED_CHANNELS set, message must be in allowed channel
 * - If ALLOWED_USERS set, user must be in allowlist OR have allowed role
 * - If ALLOWED_ROLES set, user must have allowed role OR be in user allowlist
 * 
 * DM messages:
 * - Channel/role allowlists are ignored (DMs have no guild context)
 * - Only ALLOWED_USERS is checked (if configured)
 */
export function checkAllowlist(message: Message): boolean {
  const isDM = message.channel.type === ChannelType.DM;

  // If no allowlists configured, allow everything
  if (!ALLOWED_USERS && !ALLOWED_ROLES && !ALLOWED_CHANNELS) return true;

  // DMs: only user allowlist applies (no channels or roles in DMs)
  if (isDM) {
    if (ALLOWED_USERS) return ALLOWED_USERS.has(message.author.id);
    // No user allowlist configured — allow DMs from anyone (channel/role lists don't apply)
    return true;
  }

  // Guild messages: check channel allowlist
  if (ALLOWED_CHANNELS && !ALLOWED_CHANNELS.has(message.channelId)) {
    // Also check parent channel for thread messages
    const parentId = message.channel.isThread() ? message.channel.parentId : null;
    if (!parentId || !ALLOWED_CHANNELS.has(parentId)) return false;
  }
  
  // Check user allowlist
  if (ALLOWED_USERS && ALLOWED_USERS.has(message.author.id)) return true;
  
  // Check role allowlist
  if (ALLOWED_ROLES && message.member) {
    const userRoles = message.member.roles.cache;
    for (const roleId of ALLOWED_ROLES) {
      if (userRoles.has(roleId)) return true;
    }
  }
  
  // If user/role allowlists exist but user matches neither, deny
  if (ALLOWED_USERS || ALLOWED_ROLES) return false;
  
  return true;
}
