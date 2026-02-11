import { describe, it, expect } from 'bun:test';
import { generateThreadName } from '../../src/features/thread-naming.js';

describe('generateThreadName', () => {
  it('should return short content as-is', () => {
    const result = generateThreadName('Hello world');
    expect(result).toBe('Hello world');
  });

  it('should return "New conversation" for empty content', () => {
    expect(generateThreadName('')).toBe('New conversation');
    expect(generateThreadName('   ')).toBe('New conversation');
  });

  it('should truncate at word boundary for long content', () => {
    const longText = 'This is a very long message that exceeds the maximum thread name length and should be truncated at a word boundary';
    const result = generateThreadName(longText);
    
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result).toMatch(/…$/); // Ends with ellipsis
    expect(result).not.toMatch(/\s…$/); // Doesn't end with space + ellipsis
  });

  it('should hard truncate when no good word boundary exists', () => {
    const longText = 'a'.repeat(100); // No spaces at all
    const result = generateThreadName(longText);
    
    expect(result.length).toBe(80);
    expect(result).toMatch(/…$/);
  });

  it('should use first line of multi-line content', () => {
    const multiLine = 'First line\nSecond line\nThird line';
    const result = generateThreadName(multiLine);
    
    expect(result).toBe('First line');
  });

  it('should strip markdown formatting', () => {
    const markdown = '**Bold** _italic_ ~strikethrough~ `code` #header';
    const result = generateThreadName(markdown);
    
    expect(result).toBe('Bold italic strikethrough code header');
  });

  it('should pass content exactly 80 chars without truncation', () => {
    const exactly80 = 'a'.repeat(80);
    const result = generateThreadName(exactly80);
    
    expect(result.length).toBe(80);
    expect(result).not.toMatch(/…$/);
  });

  it('should truncate content with 81 chars', () => {
    const exactly81 = 'a'.repeat(81);
    const result = generateThreadName(exactly81);
    
    expect(result.length).toBe(80);
    expect(result).toMatch(/…$/);
  });

  it('should handle complex case with markdown and long content', () => {
    const complex = '**How can I** implement _authentication_ in my ~old~ new `Next.js` application with very detailed requirements and specifications?';
    const result = generateThreadName(complex);
    
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result).not.toMatch(/[*_~`#]/); // No markdown
  });

  it('should break at word boundary above 50% threshold', () => {
    // Create text where last space is at position 60 (75% of 80)
    const text = 'a'.repeat(60) + ' ' + 'b'.repeat(30);
    const result = generateThreadName(text);
    
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result).toMatch(/a+…$/); // Should break at the space
  });
});
