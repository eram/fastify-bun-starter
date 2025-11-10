/**
 * Tests for format_number tool
 */

import { strict as assert } from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MCPServer, type ToolResult } from '../../lib/mcp-server';
import { registerFormatNumberTool } from './format-number-tool';

async function callTool(server: MCPServer, name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const response = await server.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
    });

    if (!response || 'error' in response) {
        throw new Error(response?.error?.message || 'Tool call failed');
    }

    return response.result as ToolResult;
}

async function listTools(server: MCPServer): Promise<Array<{ name: string; description: string }>> {
    const response = await server.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
    });

    if (!response || 'error' in response) {
        throw new Error('Failed to list tools');
    }

    return (response.result as { tools: Array<{ name: string; description: string }> }).tools;
}

describe('format-number-tool', () => {
    test('registers format_number tool with correct schema', async () => {
        const server = new MCPServer({ name: 'test', version: '1.0.0' });
        registerFormatNumberTool(server);

        const tools = await listTools(server);
        assert.equal(tools.length, 1);
        assert.equal(tools[0].name, 'format_number');
        assert.ok(tools[0].description.includes('Format a number'));
    });

    test('formats positive number correctly', async () => {
        const server = new MCPServer({ name: 'test', version: '1.0.0' });
        registerFormatNumberTool(server);

        const result = await callTool(server, 'format_number', {
            number: 1234567.89,
            locale: 'en-US',
        });

        assert.equal(result.isError, false);
        assert.equal(result.content.length, 1);
        assert.equal(result.content[0].type, 'text');

        const parsed = JSON.parse(result.content[0].text);
        assert.equal(parsed.number, 1234567.89);
        assert.equal(parsed.locale, 'en-US');
        assert.ok(parsed.formatted.includes('1,234,567.89'));
    });

    test('formats negative number correctly', async () => {
        const server = new MCPServer({ name: 'test', version: '1.0.0' });
        registerFormatNumberTool(server);

        const result = await callTool(server, 'format_number', {
            number: -9876.54,
            locale: 'de-DE',
        });

        assert.equal(result.isError, false);
        const parsed = JSON.parse(result.content[0].text);
        assert.equal(parsed.number, -9876.54);
        assert.equal(parsed.locale, 'de-DE');
    });

    test('formats zero correctly', async () => {
        const server = new MCPServer({ name: 'test', version: '1.0.0' });
        registerFormatNumberTool(server);

        const result = await callTool(server, 'format_number', {
            number: 0,
            locale: 'en-US',
        });

        assert.equal(result.isError, false);
        const parsed = JSON.parse(result.content[0].text);
        assert.equal(parsed.number, 0);
        assert.equal(parsed.formatted, '0');
    });

    test('handles locale without country code', async () => {
        const server = new MCPServer({ name: 'test', version: '1.0.0' });
        registerFormatNumberTool(server);

        const result = await callTool(server, 'format_number', {
            number: 1234.56,
            locale: 'en',
        });

        assert.equal(result.isError, false);
        const parsed = JSON.parse(result.content[0].text);
        assert.equal(parsed.locale, 'en');
    });

    test('rejects non-number input', async () => {
        const server = new MCPServer({ name: 'test', version: '1.0.0' });
        registerFormatNumberTool(server);

        const result = await callTool(server, 'format_number', {
            number: 'not a number',
            locale: 'en-US',
        });

        assert.equal(result.isError, true);
        assert.ok(result.content[0].text.includes('number must be a number'));
    });

    test('rejects non-string locale', async () => {
        const server = new MCPServer({ name: 'test', version: '1.0.0' });
        registerFormatNumberTool(server);

        const result = await callTool(server, 'format_number', {
            number: 123,
            locale: 123,
        });

        assert.equal(result.isError, true);
        assert.ok(result.content[0].text.includes('locale must be a string'));
    });

    test('rejects number with more than 15 digits', async () => {
        const server = new MCPServer({ name: 'test', version: '1.0.0' });
        registerFormatNumberTool(server);

        const result = await callTool(server, 'format_number', {
            number: 1234567890123456, // 16 digits
            locale: 'en-US',
        });

        assert.equal(result.isError, true);
        assert.ok(result.content[0].text.includes('at most 15 digits'));
    });

    test('rejects invalid locale format', async () => {
        const server = new MCPServer({ name: 'test', version: '1.0.0' });
        registerFormatNumberTool(server);

        const result = await callTool(server, 'format_number', {
            number: 123,
            locale: 'invalid',
        });

        assert.equal(result.isError, true);
        assert.ok(result.content[0].text.includes('IETF BCP 47 format'));
    });

    test('rejects locale with lowercase country code', async () => {
        const server = new MCPServer({ name: 'test', version: '1.0.0' });
        registerFormatNumberTool(server);

        const result = await callTool(server, 'format_number', {
            number: 123,
            locale: 'en-us', // should be en-US
        });

        assert.equal(result.isError, true);
        assert.ok(result.content[0].text.includes('IETF BCP 47 format'));
    });

    test('handles very small numbers', async () => {
        const server = new MCPServer({ name: 'test', version: '1.0.0' });
        registerFormatNumberTool(server);

        const result = await callTool(server, 'format_number', {
            number: 0.000001,
            locale: 'en-US',
        });

        assert.equal(result.isError, false);
        const parsed = JSON.parse(result.content[0].text);
        assert.equal(parsed.number, 0.000001);
    });

    test('handles large valid numbers', async () => {
        const server = new MCPServer({ name: 'test', version: '1.0.0' });
        registerFormatNumberTool(server);

        const result = await callTool(server, 'format_number', {
            number: 123456789012345, // 15 digits - max allowed
            locale: 'en-US',
        });

        assert.equal(result.isError, false);
        const parsed = JSON.parse(result.content[0].text);
        assert.equal(parsed.number, 123456789012345);
    });

    test('handles NaN as a number type', async () => {
        const server = new MCPServer({ name: 'test', version: '1.0.0' });
        registerFormatNumberTool(server);

        const result = await callTool(server, 'format_number', {
            number: Number.NaN,
            locale: 'en-US',
        });

        // NaN should either format or return an error
        assert.ok(result.content[0].text);
    });

    test('handles Infinity', async () => {
        const server = new MCPServer({ name: 'test', version: '1.0.0' });
        registerFormatNumberTool(server);

        const result = await callTool(server, 'format_number', {
            number: Number.POSITIVE_INFINITY,
            locale: 'en-US',
        });

        // Infinity should either format or return an error
        assert.ok(result.content[0].text);
    });
});
