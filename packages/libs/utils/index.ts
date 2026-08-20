/** DON'T USE BARREL IMPORT/EXPORT IN FRONTEND CODE **/
import { constants } from 'node:os';

export type { Algorithm, DurationString } from './jwt';
export { createToken, JwtPayload, verifyToken } from './jwt';

/**
 * errno utility: provides map from errno codes to names (Node.js only).
 * this replaces the buggy util.getSystemErrorName and util.getSystemErrorMessage
 * Example: getErrorName(errno.ENOENT) === "ENOENT"
 */
export const errno = constants.errno;
export const getErrorName = (e: number) => Object.keys(errno).find((key) => Object(errno)[key] === e) || e.toString();
