/**
 * Tests for MCP client validators
 */

import { strict as assert } from 'node:assert/strict';
import { describe, test } from 'node:test';
import { validators } from './client';

describe('client validators', () => {
    test('validators.list exists and can parse tool definitions', () => {
        const tools = [
            {
                name: 'test_tool',
                description: 'A test tool',
                inputSchema: {
                    type: 'object',
                    properties: new Map([['arg1', { type: 'string' }]]),
                    required: ['arg1'],
                },
            },
        ];

        const parsed = validators.list.parse(tools);
        assert.equal(parsed.length, 1);
        assert.equal(parsed[0].name, 'test_tool');
    });

    test('validators.result exists and can parse tool results', () => {
        const result = {
            content: [{ type: 'text', text: 'Result text' }],
            isError: false,
        };

        const parsed = validators.result.parse(result);
        assert.equal(parsed.isError, false);
        assert.equal(parsed.content.length, 1);
    });

    test('validators are lazily initialized', () => {
        // Access both validators
        const list = validators.list;
        const result = validators.result;

        // Should return same instances on subsequent access
        assert.equal(validators.list, list);
        assert.equal(validators.result, result);
    });

    test('validators.list validates tool definition structure', () => {
        const invalidTools = [
            {
                name: 'invalid',
                // missing description
                inputSchema: { type: 'object' },
            },
        ];

        assert.throws(() => {
            validators.list.parse(invalidTools);
        });
    });

    test('validators.result validates result structure', () => {
        const invalidResult = {
            // missing content
            isError: false,
        };

        assert.throws(() => {
            validators.result.parse(invalidResult);
        });
    });
});
