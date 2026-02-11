import { describe, it, expect, mock } from 'bun:test';
import { getChannelContext } from '../../src/features/channel-context.js';
import type { TextChannel, Collection, Message } from 'discord.js';

describe('getChannelContext', () => {
  it('should return formatted context from messages', async () => {
    const mockMessages = new Map([
      ['1', { author: { tag: 'user1' }, content: 'Hello' }],
      ['2', { author: { tag: 'user2' }, content: 'Hi there' }],
      ['3', { author: { tag: 'user1' }, content: 'How are you?' }],
    ]) as unknown as Collection<string, Message>;

    const fetchMock = mock(() => Promise.resolve(mockMessages));
    const channel = {
      messages: { fetch: fetchMock },
    } as unknown as TextChannel;

    const result = await getChannelContext(channel);

    expect(fetchMock).toHaveBeenCalledWith({ limit: 10 });
    expect(result).toContain('Recent channel context:');
    expect(result).toContain('user1: Hello');
    expect(result).toContain('user2: Hi there');
    expect(result).toContain('user1: How are you?');
  });

  it('should return empty string when no messages', async () => {
    const mockMessages = new Map() as unknown as Collection<string, Message>;

    const fetchMock = mock(() => Promise.resolve(mockMessages));
    const channel = {
      messages: { fetch: fetchMock },
    } as unknown as TextChannel;

    const result = await getChannelContext(channel);

    expect(result).toBe('');
  });

  it('should handle fetch failure gracefully', async () => {
    const fetchMock = mock(() => Promise.reject(new Error('Fetch failed')));
    const channel = {
      messages: { fetch: fetchMock },
    } as unknown as TextChannel;

    const result = await getChannelContext(channel);

    expect(result).toBe('');
  });

  it('should respect message limit of 10', async () => {
    const fetchMock = mock(() => Promise.resolve(new Map() as unknown as Collection<string, Message>));
    const channel = {
      messages: { fetch: fetchMock },
    } as unknown as TextChannel;

    await getChannelContext(channel);

    expect(fetchMock).toHaveBeenCalledWith({ limit: 10 });
  });

  it('should filter out empty content lines', async () => {
    const mockMessages = new Map([
      ['1', { author: { tag: 'user1' }, content: 'Hello' }],
      ['2', { author: { tag: 'user2' }, content: '' }],
      ['3', { author: { tag: 'user3' }, content: 'World' }],
    ]) as unknown as Collection<string, Message>;

    const fetchMock = mock(() => Promise.resolve(mockMessages));
    const channel = {
      messages: { fetch: fetchMock },
    } as unknown as TextChannel;

    const result = await getChannelContext(channel);

    expect(result).toContain('user1: Hello');
    expect(result).toContain('user3: World');
    expect(result).not.toContain('user2:');
  });
});
