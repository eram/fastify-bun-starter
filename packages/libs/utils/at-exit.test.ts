import { describe, expect, mock, spyOn, test } from 'bun:test';
import { sleep } from '@libs/utils/time';
import { type AtExit, atExit } from './at-exit';

// NB!!!
// Skip these tests in batch mode - they emit SIGINT signals that interfere with test runner
// you can run it manually to test the functionality.
describe.skip('atExit', () => {
    test('remove removes a callback', () => {
        const cb = mock() as never as AtExit;
        const remove = atExit(cb);
        expect(remove()).toBe(true);
        expect(remove()).toBe(false);
    });

    test('callbacks are called on signal in LIFO order', async () => {
        const cb1 = mock(() => Promise.resolve()); // should be called 2nd
        const cb2 = mock(() => expect(cb1.mock.calls.length).toBe(0)); // should be called 1st
        const exit = spyOn(process, 'exit').mockImplementation(() => expect(cb2.mock.calls.length).toBe(1) as never);
        try {
            const remove1 = atExit(cb1);
            const remove2 = atExit(cb2);

            process.emit('SIGINT', 'SIGINT');
            await sleep(1); // wait for callbacks to finish

            expect(cb1.mock.calls.length).toBe(1);
            expect(cb2.mock.calls.length).toBe(1);

            remove2();
            remove1();
        } finally {
            exit.mockRestore();
        }
    });

    test('trigger timeout exit on a long callback', async () => {
        const save = process.env.AT_TERMINATE_TIMEOUT;
        process.env.AT_TERMINATE_TIMEOUT = '2';
        const cb1 = mock(() => sleep(10)); // should trigger the timeout
        const exit = spyOn(process, 'exit').mockImplementation(() => {
            // should be called once from signal and once from timeout
            expect(cb1.mock.calls.length).toBe(1);
            return undefined as never;
        });

        const remove1 = atExit(cb1);
        try {
            process.emit('SIGINT', 'SIGINT');
            await sleep(50); // wait for callbacks to finish

            expect(cb1.mock.calls.length).toBe(1);
            expect(exit.mock.calls.length).toBe(2);
        } finally {
            remove1();
            exit.mockRestore();
            process.env.AT_TERMINATE_TIMEOUT = save;
        }
    });
});
