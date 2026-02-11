import { describe, it, expect, beforeEach } from 'bun:test';
import { ChannelType, type Message } from 'discord.js';

// Helper to create mock message
function createMockMessage(overrides: Partial<{
  authorId: string;
  channelId: string;
  isThread: boolean;
  parentId: string | null;
  memberRoles: string[];
  isDM: boolean;
}>): Message {
  const {
    authorId = 'user123',
    channelId = 'channel456',
    isThread = false,
    parentId = null,
    memberRoles = [],
    isDM = false,
  } = overrides;

  return {
    author: { id: authorId },
    channelId,
    channel: {
      type: isDM ? ChannelType.DM : (isThread ? ChannelType.PublicThread : ChannelType.GuildText),
      isThread: () => isThread,
      parentId,
    },
    member: (!isDM && memberRoles.length > 0) ? {
      roles: {
        cache: {
          has: (roleId: string) => memberRoles.includes(roleId),
        },
      },
    } : null,
  } as unknown as Message;
}

describe('allowlist middleware', () => {
  beforeEach(() => {
    // Clear module cache to reload with new env vars
    delete require.cache[require.resolve('../../src/middleware/allowlist.ts')];
  });

  it('allows all messages when no allowlists configured', async () => {
    delete process.env.ALLOWED_USERS;
    delete process.env.ALLOWED_ROLES;
    delete process.env.ALLOWED_CHANNELS;
    
    const { checkAllowlist } = await import('../../src/middleware/allowlist.ts');
    const message = createMockMessage({ authorId: 'anyone' });
    
    expect(checkAllowlist(message)).toBe(true);
  });

  it('allows only specified users when ALLOWED_USERS is set', async () => {
    process.env.ALLOWED_USERS = 'user1,user2';
    delete process.env.ALLOWED_ROLES;
    delete process.env.ALLOWED_CHANNELS;
    
    const { checkAllowlist } = await import('../../src/middleware/allowlist.ts');
    
    const allowedUser = createMockMessage({ authorId: 'user1' });
    const deniedUser = createMockMessage({ authorId: 'user3' });
    
    expect(checkAllowlist(allowedUser)).toBe(true);
    expect(checkAllowlist(deniedUser)).toBe(false);
  });

  it('allows only specified roles when ALLOWED_ROLES is set', async () => {
    delete process.env.ALLOWED_USERS;
    process.env.ALLOWED_ROLES = 'role1,role2';
    delete process.env.ALLOWED_CHANNELS;
    
    const { checkAllowlist } = await import('../../src/middleware/allowlist.ts');
    
    const allowedRole = createMockMessage({ memberRoles: ['role1'] });
    const deniedRole = createMockMessage({ memberRoles: ['role3'] });
    const noMember = createMockMessage({ memberRoles: [] });
    
    expect(checkAllowlist(allowedRole)).toBe(true);
    expect(checkAllowlist(deniedRole)).toBe(false);
    expect(checkAllowlist(noMember)).toBe(false);
  });

  it('allows only specified channels when ALLOWED_CHANNELS is set', async () => {
    delete process.env.ALLOWED_USERS;
    delete process.env.ALLOWED_ROLES;
    process.env.ALLOWED_CHANNELS = 'channel1,channel2';
    
    const { checkAllowlist } = await import('../../src/middleware/allowlist.ts');
    
    const allowedChannel = createMockMessage({ channelId: 'channel1' });
    const deniedChannel = createMockMessage({ channelId: 'channel3' });
    
    expect(checkAllowlist(allowedChannel)).toBe(true);
    expect(checkAllowlist(deniedChannel)).toBe(false);
  });

  it('checks parent channel for thread messages', async () => {
    delete process.env.ALLOWED_USERS;
    delete process.env.ALLOWED_ROLES;
    process.env.ALLOWED_CHANNELS = 'parent1';
    
    const { checkAllowlist } = await import('../../src/middleware/allowlist.ts');
    
    const threadInAllowedParent = createMockMessage({
      channelId: 'thread123',
      isThread: true,
      parentId: 'parent1',
    });
    
    const threadInDeniedParent = createMockMessage({
      channelId: 'thread456',
      isThread: true,
      parentId: 'parent2',
    });
    
    expect(checkAllowlist(threadInAllowedParent)).toBe(true);
    expect(checkAllowlist(threadInDeniedParent)).toBe(false);
  });

  it('allows user in ALLOWED_USERS even without allowed role', async () => {
    process.env.ALLOWED_USERS = 'user1';
    process.env.ALLOWED_ROLES = 'role1';
    delete process.env.ALLOWED_CHANNELS;
    
    const { checkAllowlist } = await import('../../src/middleware/allowlist.ts');
    
    const allowedUser = createMockMessage({
      authorId: 'user1',
      memberRoles: ['role2'], // Wrong role, but user is in allowlist
    });
    
    expect(checkAllowlist(allowedUser)).toBe(true);
  });

  it('allows user with allowed role even if not in ALLOWED_USERS', async () => {
    process.env.ALLOWED_USERS = 'user1';
    process.env.ALLOWED_ROLES = 'role1';
    delete process.env.ALLOWED_CHANNELS;
    
    const { checkAllowlist } = await import('../../src/middleware/allowlist.ts');
    
    const allowedRole = createMockMessage({
      authorId: 'user2', // Not in user allowlist
      memberRoles: ['role1'],
    });
    
    expect(checkAllowlist(allowedRole)).toBe(true);
  });

  it('denies user without allowed role or user ID', async () => {
    process.env.ALLOWED_USERS = 'user1';
    process.env.ALLOWED_ROLES = 'role1';
    delete process.env.ALLOWED_CHANNELS;
    
    const { checkAllowlist } = await import('../../src/middleware/allowlist.ts');
    
    const deniedUser = createMockMessage({
      authorId: 'user2',
      memberRoles: ['role2'],
    });
    
    expect(checkAllowlist(deniedUser)).toBe(false);
  });

  it('handles empty env var values as no restriction', async () => {
    process.env.ALLOWED_USERS = '';
    process.env.ALLOWED_ROLES = '  ';
    process.env.ALLOWED_CHANNELS = '';
    
    const { checkAllowlist } = await import('../../src/middleware/allowlist.ts');
    
    const message = createMockMessage({ authorId: 'anyone' });
    expect(checkAllowlist(message)).toBe(true);
  });

  it('trims whitespace from comma-separated values', async () => {
    process.env.ALLOWED_USERS = 'user1 , user2  ,  user3';
    delete process.env.ALLOWED_ROLES;
    delete process.env.ALLOWED_CHANNELS;
    
    const { checkAllowlist } = await import('../../src/middleware/allowlist.ts');
    
    const user1 = createMockMessage({ authorId: 'user1' });
    const user2 = createMockMessage({ authorId: 'user2' });
    const user3 = createMockMessage({ authorId: 'user3' });
    
    expect(checkAllowlist(user1)).toBe(true);
    expect(checkAllowlist(user2)).toBe(true);
    expect(checkAllowlist(user3)).toBe(true);
  });

  // DM-specific tests
  it('allows DMs from any user when no allowlists configured', async () => {
    delete process.env.ALLOWED_USERS;
    delete process.env.ALLOWED_ROLES;
    delete process.env.ALLOWED_CHANNELS;
    
    const { checkAllowlist } = await import('../../src/middleware/allowlist.ts');
    const dm = createMockMessage({ authorId: 'anyone', isDM: true });
    
    expect(checkAllowlist(dm)).toBe(true);
  });

  it('allows DMs from listed users when ALLOWED_USERS is set', async () => {
    process.env.ALLOWED_USERS = 'user1,user2';
    delete process.env.ALLOWED_ROLES;
    delete process.env.ALLOWED_CHANNELS;
    
    const { checkAllowlist } = await import('../../src/middleware/allowlist.ts');
    
    const allowed = createMockMessage({ authorId: 'user1', isDM: true });
    const denied = createMockMessage({ authorId: 'user3', isDM: true });
    
    expect(checkAllowlist(allowed)).toBe(true);
    expect(checkAllowlist(denied)).toBe(false);
  });

  it('ignores ALLOWED_CHANNELS for DMs', async () => {
    delete process.env.ALLOWED_USERS;
    delete process.env.ALLOWED_ROLES;
    process.env.ALLOWED_CHANNELS = 'channel1';
    
    const { checkAllowlist } = await import('../../src/middleware/allowlist.ts');
    
    // DM channel ID won't be in the channel allowlist, but should still be allowed
    const dm = createMockMessage({ authorId: 'anyone', channelId: 'dm-channel-999', isDM: true });
    expect(checkAllowlist(dm)).toBe(true);
  });

  it('ignores ALLOWED_ROLES for DMs', async () => {
    delete process.env.ALLOWED_USERS;
    process.env.ALLOWED_ROLES = 'role1';
    delete process.env.ALLOWED_CHANNELS;
    
    const { checkAllowlist } = await import('../../src/middleware/allowlist.ts');
    
    // DMs have no guild member/roles — should still be allowed when only roles are configured
    const dm = createMockMessage({ authorId: 'anyone', isDM: true });
    expect(checkAllowlist(dm)).toBe(true);
  });

  it('checks ALLOWED_USERS for DMs even when roles/channels are also set', async () => {
    process.env.ALLOWED_USERS = 'user1';
    process.env.ALLOWED_ROLES = 'role1';
    process.env.ALLOWED_CHANNELS = 'channel1';
    
    const { checkAllowlist } = await import('../../src/middleware/allowlist.ts');
    
    const allowed = createMockMessage({ authorId: 'user1', isDM: true });
    const denied = createMockMessage({ authorId: 'user2', isDM: true });
    
    expect(checkAllowlist(allowed)).toBe(true);
    expect(checkAllowlist(denied)).toBe(false);
  });
});
