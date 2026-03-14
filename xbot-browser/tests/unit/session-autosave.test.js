'use strict';

const { createAutoSaver } = require('../../src/browser/session');

describe('createAutoSaver', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('returns null when no session file', () => {
    expect(createAutoSaver(null)).toBeNull();
    expect(createAutoSaver('')).toBeNull();
    expect(createAutoSaver(undefined)).toBeNull();
  });

  test('returns object with schedule and flush methods', () => {
    const saver = createAutoSaver('/tmp/test-session.json');
    expect(saver).toBeTruthy();
    expect(typeof saver.schedule).toBe('function');
    expect(typeof saver.flush).toBe('function');
  });

  test('flush calls saveSession on the context', async () => {
    jest.useRealTimers();
    const saver = createAutoSaver('/tmp/test-autosave.json');
    const mockContext = {
      storageState: jest.fn().mockResolvedValue({ cookies: [], origins: [] }),
    };

    // flush should not throw even if file operations fail
    await expect(saver.flush(mockContext)).resolves.not.toThrow();
  });

  test('createAutoSaver accepts custom debounceMs', () => {
    const saver = createAutoSaver('/tmp/test-custom-debounce.json', 500);
    expect(saver).toBeTruthy();
    expect(typeof saver.schedule).toBe('function');
    expect(typeof saver.flush).toBe('function');
  });

  test('schedule called multiple times only triggers one save (debounce)', () => {
    const saver = createAutoSaver('/tmp/test-debounce.json', 1000);
    const mockContext = {
      storageState: jest.fn().mockResolvedValue({ cookies: [], origins: [] }),
    };

    // Schedule multiple times rapidly
    saver.schedule(mockContext);
    saver.schedule(mockContext);
    saver.schedule(mockContext);
    saver.schedule(mockContext);
    saver.schedule(mockContext);

    // Advance time past the debounce window
    jest.advanceTimersByTime(1500);

    // storageState should only have been called once since each schedule
    // clears the previous timer and sets a new one
    expect(mockContext.storageState).toHaveBeenCalledTimes(1);
  });

  test('flush cancels pending scheduled save', async () => {
    jest.useRealTimers();
    const saver = createAutoSaver('/tmp/test-flush-cancel.json', 5000);
    const mockContext = {
      storageState: jest.fn().mockResolvedValue({ cookies: [], origins: [] }),
    };

    // Schedule a save with long debounce
    saver.schedule(mockContext);

    // Immediately flush - this should cancel the scheduled save and save now
    await saver.flush(mockContext);

    // storageState called once from flush
    expect(mockContext.storageState).toHaveBeenCalledTimes(1);
  });

  test('flush with no pending timer still saves', async () => {
    jest.useRealTimers();
    const saver = createAutoSaver('/tmp/test-flush-no-timer.json');
    const mockContext = {
      storageState: jest.fn().mockResolvedValue({ cookies: [], origins: [] }),
    };

    // Never called schedule, but flush should still work
    await saver.flush(mockContext);
    expect(mockContext.storageState).toHaveBeenCalledTimes(1);
  });

  test('schedule after flush works normally', async () => {
    jest.useRealTimers();
    const saver = createAutoSaver('/tmp/test-schedule-after-flush.json', 100);
    const mockContext = {
      storageState: jest.fn().mockResolvedValue({ cookies: [], origins: [] }),
    };

    // Flush first
    await saver.flush(mockContext);
    expect(mockContext.storageState).toHaveBeenCalledTimes(1);

    // Now schedule should still work
    saver.schedule(mockContext);

    // Wait for the debounce to fire
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(mockContext.storageState).toHaveBeenCalledTimes(2);
  });
});
