//
// this lib implements the best practices for handling termination on nodejs
// see https://blog.heroku.com/best-practices-nodejs-errors
// app can register callbacks to be called on process graceful termination.
// the lib also registers unhandled-exception handlers on first call to atExit()
//

export type AtExit = (sig?: NodeJS.Signals) => void | Promise<void>;
const cbs: AtExit[] = [];

// on exit close gracefully with a timeout: last-in-first-out
function makeExitHandler(code: number, sig: NodeJS.Signals) {
    return async () => {
        console.warn(`Exiting on ${sig}...`);

        // Explicitly use the value getter to ensure we get a number
        const to = setTimeout(() => {
            clearTimeout(to);
            console.warn(`Exiting on ${sig} timeout. Killing process.`);
            process.exit(code);
        }, Number(process.env.AT_TERMINATE_TIMEOUT) || 1000).unref();

        const waitings: Promise<void>[] = [];
        let cb: AtExit | undefined;
        while ((cb = cbs.pop())) {
            try {
                const rc = cb(sig);
                if (rc instanceof Promise) waitings.push(rc);
            } catch (e) {
                console.warn(`atExit error in '${cb.name}': ${e}`);
            }
        }

        await Promise.all(waitings);
        process.exit(code);
    };
}

// on error we just err-out and terminate
function makeErrorHandler(reason: string) {
    return (err: Error & { errno?: number }) => {
        console.error(reason, err.stack ?? err);
        process.exit(err.errno ?? 9); // 9 = EBADF equivalent
    };
}

// remove a callback (removeEventListener)
// returns true is removed successfully.
function remove(cb: AtExit) {
    const n = cbs.indexOf(cb);
    if (n >= 0) cbs.splice(n, 1);
    return n >= 0;
}

/**
 * Graceful termination function: last-in-first-out.
 * returns a callback that can later be called to remove the handler.
 */
export function atExit(cb: AtExit) {
    // initialize handlers on first call
    if (!cbs.length) {
        process.once('uncaughtException', makeErrorHandler('Unexpected Error'));
        process.once('unhandledRejection', makeErrorHandler('Unhandled Promise'));
        process.once('SIGTERM', makeExitHandler(0, 'SIGTERM'));
        process.once('SIGINT', makeExitHandler(0, 'SIGINT'));
    }

    cbs.push(cb);
    return () => remove(cb);
}
