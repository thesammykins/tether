import { describe, it, expect, mock } from 'bun:test';
import { acknowledgeMessage } from '../../src/features/ack.js';
import type { Message } from 'discord.js';

describe('acknowledgeMessage', () => {
  it('should call message.react with 👀 emoji', async () => {
    const reactMock = mock(() => Promise.resolve());
    const message = {
      react: reactMock,
    } as unknown as Message;

    await acknowledgeMessage(message);

    expect(reactMock).toHaveBeenCalledTimes(1);
    expect(reactMock).toHaveBeenCalledWith('👀');
  });

  it('should handle react failure gracefully without throwing', async () => {
    const reactMock = mock(() => Promise.reject(new Error('Permission denied')));
    const message = {
      react: reactMock,
    } as unknown as Message;

    // Should not throw
    await expect(acknowledgeMessage(message)).resolves.toBeUndefined();
    expect(reactMock).toHaveBeenCalledTimes(1);
  });
});
