/**
 * MCP Configuration
 */

export {
    getManager,
    type MCPConfigManager,
    type MCPConfigManagerEvents,
} from './manager';

export type {
    MCPConfigFile as MCPConfig,
    MCPEnv as MCPEnvVars,
    MCPServerConfig,
    MCPTransport,
} from './types';
