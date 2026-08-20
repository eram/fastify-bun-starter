import { describe, expect, test } from 'bun:test';
import { array, bigint, boolean, date, literal, map, nullable, nullish, number, object, set, string, union } from './index';
import { fromJsonSchema, type JsonSchema, toJsonSchema } from './schema';

const defOpts = () => ({ includeSchemaVersion: false });

describe('Validator Schema', () => {
    // jsonSchema basic types
    test('should convert primitive types', () => {
        const result = toJsonSchema(
            object({
                name: string(),
                age: number(),
                active: boolean(),
                count: bigint(),
                created: date(),
            }),
            defOpts(),
        );

        expect(result).toEqual({
            type: 'object',
            properties: {
                name: { type: 'string' },
                age: { type: 'number' },
                active: { type: 'boolean' },
                count: { type: 'integer' },
                created: { type: 'string', format: 'date-time' },
            },
            required: ['name', 'age', 'active', 'count', 'created'],
            additionalProperties: false,
        });
    });

    test('should convert object schemas with nesting', () => {
        const simple = toJsonSchema(
            object({
                name: string(),
                age: number(),
            }),
            defOpts(),
        );

        expect(simple).toEqual({
            type: 'object',
            properties: {
                name: { type: 'string' },
                age: { type: 'number' },
            },
            required: ['name', 'age'],
            additionalProperties: false,
        });

        const nested = toJsonSchema(
            object({
                user: object({
                    name: string(),
                    age: number(),
                }),
            }),
            defOpts(),
        );

        expect(nested.properties?.['user']).toEqual({
            type: 'object',
            properties: {
                name: { type: 'string' },
                age: { type: 'number' },
            },
            required: ['name', 'age'],
            additionalProperties: false,
        });

        const deep = toJsonSchema(
            object({
                data: object({
                    user: object({
                        profile: object({
                            name: string(),
                        }),
                    }),
                }),
            }),
            defOpts(),
        );

        expect(deep.properties?.['data']);
        const dataProps = (deep.properties!['data'] as { properties?: Record<string, unknown> }).properties;
        expect(dataProps?.['user']);
        const userProps = (dataProps!['user'] as { properties?: Record<string, unknown> }).properties;
        expect(userProps?.['profile']);
        expect(userProps?.['profile']).toEqual({
            type: 'object',
            properties: {
                name: { type: 'string' },
            },
            required: ['name'],
            additionalProperties: false,
        });
    });

    test('should handle optional properties', () => {
        const result = toJsonSchema(
            object({
                name: string(),
                email: string().optional(),
            }),
            defOpts(),
        );

        expect(result).toEqual({
            type: 'object',
            properties: {
                name: { type: 'string' },
                email: { type: 'string' },
            },
            required: ['name'],
            additionalProperties: false,
        });
    });

    test('should convert array types', () => {
        const strings = toJsonSchema(object({ tags: array(string()) }), defOpts());
        expect(strings.properties?.['tags']).toEqual({
            type: 'array',
            items: { type: 'string' },
        });

        const numbers = toJsonSchema(object({ scores: array(number()) }), defOpts());
        expect(numbers.properties?.['scores']).toEqual({
            type: 'array',
            items: { type: 'number' },
        });

        const objects = toJsonSchema(
            object({
                users: array(object({ name: string(), age: number() })),
            }),
            defOpts(),
        );
        expect(objects.properties?.['users']).toEqual({
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    name: { type: 'string' },
                    age: { type: 'number' },
                },
                required: ['name', 'age'],
                additionalProperties: false,
            },
        });

        const generic = toJsonSchema(object({ items: array() }), defOpts());
        expect(generic.properties?.['items']).toEqual({ type: 'array' });

        const nested = toJsonSchema(object({ matrix: array(array(number())) }), defOpts());
        expect(nested.properties?.['matrix']).toEqual({
            type: 'array',
            items: {
                type: 'array',
                items: { type: 'number' },
            },
        });
    });

    test('should convert union types', () => {
        const primitives = toJsonSchema(
            object({
                value: union([string(), number()]),
            }),
            defOpts(),
        );
        expect(primitives.properties?.['value']).toEqual({
            type: ['string', 'number'],
        });

        const withBoolean = toJsonSchema(
            object({
                flag: union([string(), boolean()]),
            }),
            defOpts(),
        );
        expect(withBoolean.properties?.['flag']).toEqual({
            type: ['string', 'boolean'],
        });

        const three = toJsonSchema(
            object({
                data: union([string(), number(), boolean()]),
            }),
            defOpts(),
        );
        expect(three.properties?.['data']).toEqual({
            type: ['string', 'number', 'boolean'],
        });

        const optional = toJsonSchema(
            object({
                value: union([string(), number()]).optional(),
            }),
            defOpts(),
        );
        expect(optional.properties?.['value']).toEqual({
            type: ['string', 'number'],
        });
        expect(optional.required).toEqual([]);
    });

    test('should convert literal types', () => {
        const stringLit = toJsonSchema(object({ status: literal('pending') }), defOpts());
        expect(stringLit.properties?.['status']).toEqual({
            type: 'string',
            const: 'pending',
        });

        const numberLit = toJsonSchema(object({ code: literal(404) }), defOpts());
        expect(numberLit.properties?.['code']).toEqual({
            type: 'number',
            const: 404,
        });

        const boolLit = toJsonSchema(object({ enabled: literal(true) }), defOpts());
        expect(boolLit.properties?.['enabled']).toEqual({
            type: 'boolean',
            const: true,
        });

        const nullLit = toJsonSchema(object({ data: literal(null) }), defOpts());
        expect(nullLit.properties?.['data']).toEqual({
            type: 'null',
        });
    });

    test('should convert nullable types', () => {
        const str = toJsonSchema(object({ name: nullable(string()) }), defOpts());
        expect(str.properties?.['name']).toEqual({
            type: ['string', 'null'],
        });

        const num = toJsonSchema(object({ count: nullable(number()) }), defOpts());
        expect(num.properties?.['count']).toEqual({
            type: ['number', 'null'],
        });

        const bool = toJsonSchema(object({ active: nullable(boolean()) }), defOpts());
        expect(bool.properties?.['active']).toEqual({
            type: ['boolean', 'null'],
        });

        const arr = toJsonSchema(object({ tags: nullable(array(string())) }), defOpts());
        expect(arr.properties?.['tags']).toEqual({
            anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
        });

        const optNull = toJsonSchema(object({ name: nullable(string()).optional() }), defOpts());
        expect(optNull.properties?.['name']).toEqual({
            type: ['string', 'null'],
        });
        expect(optNull.required).toEqual([]);
    });

    test('should convert nullish types', () => {
        const str = toJsonSchema(object({ name: nullish(string()) }), defOpts());
        expect(str.properties?.['name']).toEqual({
            type: ['string', 'null'],
        });
        expect(str.required).toEqual([]);

        const num = toJsonSchema(object({ age: nullish(number()) }), defOpts());
        expect(num.properties?.['age']).toEqual({
            type: ['number', 'null'],
        });
        expect(num.required).toEqual([]);
    });

    test('should convert set and map types', () => {
        const setStr = toJsonSchema(object({ tags: set(string()) }), defOpts());
        expect(setStr.properties?.['tags']).toEqual({
            type: 'array',
            uniqueItems: true,
            items: { type: 'string' },
        });

        const setNum = toJsonSchema(object({ ids: set(number()) }), defOpts());
        expect(setNum.properties?.['ids']).toEqual({
            type: 'array',
            uniqueItems: true,
            items: { type: 'number' },
        });

        const setGen = toJsonSchema(object({ values: set() }), defOpts());
        expect(setGen.properties?.['values']).toEqual({
            type: 'array',
            uniqueItems: true,
        });

        const mapStr = toJsonSchema(object({ metadata: map(string()) }), defOpts());
        expect(mapStr.properties?.['metadata']).toEqual({
            type: 'object',
            additionalProperties: { type: 'string' },
        });

        const mapNum = toJsonSchema(object({ counters: map(number()) }), defOpts());
        expect(mapNum.properties?.['counters']).toEqual({
            type: 'object',
            additionalProperties: { type: 'number' },
        });

        const mapGen = toJsonSchema(object({ data: map() }), defOpts());
        expect(mapGen.properties?.['data']).toEqual({
            type: 'object',
            additionalProperties: true,
        });
    });

    // Json schema builup
    test('should control schema version inclusion and targets', () => {
        const withVersion = toJsonSchema(object({ name: string() }), { ...defOpts(), includeSchemaVersion: true });
        expect(withVersion.$schema, 'http://json-schema.org/draft-07/schema#');

        const schema2019 = toJsonSchema(object({ name: string() }), {
            ...defOpts(),
            includeSchemaVersion: true,
            target: 'jsonSchema2019-09',
        });
        expect(schema2019.$schema, 'https://json-schema.org/draft/2019-09/schema');

        const schema2020 = toJsonSchema(object({ name: string() }), {
            ...defOpts(),
            includeSchemaVersion: true,
            target: 'jsonSchema2020-12',
        });
        expect(schema2020.$schema, 'https://json-schema.org/draft/2020-12/schema');

        const openApi = toJsonSchema(object({ name: string() }), {
            ...defOpts(),
            includeSchemaVersion: true,
            target: 'openApi3',
        });
        expect(openApi.$schema, undefined);

        const noVersion = toJsonSchema(object({ name: string() }));
        expect(noVersion.$schema, undefined);
    });

    test('should handle naming and definition paths', () => {
        const withName = toJsonSchema(object({ name: string() }), { name: 'User', title: 'USER' });
        expect(withName.$ref, '#/definitions/User');
        expect(Object(withName).definitions);
        expect(Object(withName).definitions.User);

        const customPath = toJsonSchema(object({ name: string() }), {
            ...defOpts(),
            name: 'User',
            definitionPath: 'definitions',
            includeSchemaVersion: false,
        });
        expect(Object(customPath).$ref, '#/definitions/User');
        expect(Object(customPath).definitions);
        expect(Object(customPath).definitions.User);

        const stringAsName = toJsonSchema(object({ name: string() }), 'User');
        expect(Object(stringAsName).$ref, '#/definitions/User');
        expect(Object(stringAsName).definitions);
        expect(Object(stringAsName).definitions.User);
    });

    test('should control additional properties', () => {
        const allowed = toJsonSchema(object({ name: string() }), {
            ...defOpts(),
            includeSchemaVersion: false,
            additionalProperties: true,
        });
        expect(allowed.additionalProperties).toBe(true);

        const disallowed = toJsonSchema(object({ name: string() }), defOpts());
        expect(disallowed.additionalProperties).toBe(false);
    });

    test('should convert complex schemas', () => {
        const userSchema = toJsonSchema(
            object({
                id: number(),
                name: string(),
                email: string().optional(),
                roles: array(string()),
                isActive: boolean(),
            }),
            { ...defOpts(), includeSchemaVersion: false },
        );

        expect(userSchema).toEqual({
            type: 'object',
            properties: {
                id: { type: 'number' },
                name: { type: 'string' },
                email: { type: 'string' },
                roles: {
                    type: 'array',
                    items: { type: 'string' },
                },
                isActive: { type: 'boolean' },
            },
            required: ['id', 'name', 'roles', 'isActive'],
            additionalProperties: false,
        });

        const nested = toJsonSchema(
            object({
                company: object({
                    name: string(),
                    employees: array(
                        object({
                            id: number(),
                            name: string(),
                            department: string().optional(),
                        }),
                    ),
                }),
            }),
            defOpts(),
        );

        expect(nested.properties?.['company']);
        const companyProps = (nested.properties!['company'] as { properties?: Record<string, unknown> }).properties;
        expect(companyProps?.['employees']);
        const empItems = (companyProps!['employees'] as { items?: Record<string, unknown> }).items;
        expect(empItems).toEqual({
            type: 'object',
            properties: {
                id: { type: 'number' },
                name: { type: 'string' },
                department: { type: 'string' },
            },
            required: ['id', 'name'],
            additionalProperties: false,
        });

        const mixed = toJsonSchema(
            object({
                id: number(),
                name: string(),
                tags: set(string()),
                metadata: map(string()),
                status: literal('active'),
                count: nullable(number()),
                optional: string().optional(),
            }),
            defOpts(),
        );

        expect(mixed.required?.length).toBe(6);
        expect(mixed.properties?.['status']).toEqual({
            type: 'string',
            const: 'active',
        });
    });

    test('should handle edge cases', () => {
        const empty = toJsonSchema(object({}), defOpts());
        expect(empty).toEqual({
            type: 'object',
            properties: {},
            required: [],
            additionalProperties: false,
        });
    });

    test('should include descriptions', () => {
        const simple = toJsonSchema(
            object({
                name: string().describe('The user name'),
            }),
            defOpts(),
        );
        expect(simple.properties);
        expect(simple.properties?.['name']).toEqual({
            type: 'string',
            description: 'The user name',
        });

        const withConstraints = toJsonSchema(
            object({
                age: number().min(0).max(120).describe('Age in years'),
            }),
            defOpts(),
        );
        expect(withConstraints.properties);
        expect(withConstraints.properties?.['age']).toEqual({
            type: 'number',
            minimum: 0,
            maximum: 120,
            description: 'Age in years',
        });
    });

    // type constraints
    test('should include number constraints', () => {
        const min = toJsonSchema(object({ age: number().min(18) }), defOpts());
        expect(min.properties?.['age']).toEqual({ type: 'number', minimum: 18 });

        const max = toJsonSchema(object({ age: number().max(65) }), defOpts());
        expect(max.properties?.['age']).toEqual({ type: 'number', maximum: 65 });

        const gtNum = toJsonSchema(object({ score: number().gt(0) }), defOpts());
        expect(gtNum.properties?.['score']).toEqual({ type: 'number', exclusiveMinimum: 0 });

        const ltNum = toJsonSchema(object({ score: number().lt(100) }), defOpts());
        expect(ltNum.properties?.['score']).toEqual({ type: 'number', exclusiveMaximum: 100 });

        const multiple = toJsonSchema(object({ price: number().multipleOf(0.01) }), defOpts());
        expect(multiple.properties?.['price']).toEqual({ type: 'number', multipleOf: 0.01 });

        const combined = toJsonSchema(
            object({
                percentage: number().min(0).max(100).multipleOf(0.1),
            }),
            defOpts(),
        );
        expect(combined.properties?.['percentage']).toEqual({
            type: 'number',
            minimum: 0,
            maximum: 100,
            multipleOf: 0.1,
        });
    });

    test('should include string constraints', () => {
        const min = toJsonSchema(object({ name: string().min(3) }), defOpts());
        expect(min.properties?.['name']).toEqual({ type: 'string', minLength: 3 });

        const max = toJsonSchema(object({ name: string().max(50) }), defOpts());
        expect(max.properties?.['name']).toEqual({ type: 'string', maxLength: 50 });

        const pattern = toJsonSchema(object({ code: string().regex(/^[A-Z]{3}$/) }), defOpts());
        expect(pattern.properties?.['code']).toEqual({ type: 'string', pattern: '^[A-Z]{3}$' });

        const combined = toJsonSchema(
            object({
                username: string()
                    .min(3)
                    .max(20)
                    .regex(/^[a-z0-9_]+$/),
            }),
            defOpts(),
        );
        expect(combined.properties?.['username']).toEqual({
            type: 'string',
            minLength: 3,
            maxLength: 20,
            pattern: '^[a-z0-9_]+$',
        });
    });

    test('should include array constraints', () => {
        const min = toJsonSchema(object({ tags: array(string()).minLength(1) }), defOpts());
        expect(min.properties?.['tags']).toEqual({
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
        });

        const max = toJsonSchema(object({ tags: array(string()).maxLength(10) }), defOpts());
        expect(max.properties?.['tags']).toEqual({
            type: 'array',
            items: { type: 'string' },
            maxItems: 10,
        });

        const combined = toJsonSchema(
            object({
                items: array(number()).minLength(1).maxLength(100),
            }),
            defOpts(),
        );
        expect(combined.properties?.['items']).toEqual({
            type: 'array',
            items: { type: 'number' },
            minItems: 1,
            maxItems: 100,
        });
    });

    test('should include default values', () => {
        const simple = toJsonSchema(
            object({
                status: string().default('pending'),
            }),
            defOpts(),
        );
        expect(simple.properties?.['status']).toEqual({
            type: 'string',
            default: 'pending',
        });

        const withConstraints = toJsonSchema(
            object({
                count: number().min(0).max(100).default(0),
            }),
            defOpts(),
        );
        expect(withConstraints.properties?.['count']).toEqual({
            type: 'number',
            minimum: 0,
            maximum: 100,
            default: 0,
        });
    });

    test('should include bigint constraints', () => {
        const min = toJsonSchema(object({ count: bigint().min(0n) }), defOpts());
        expect(min.properties?.['count']).toEqual({ type: 'integer', minimum: 0 });

        const max = toJsonSchema(object({ count: bigint().max(1000n) }), defOpts());
        expect(max.properties?.['count']).toEqual({ type: 'integer', maximum: 1000 });

        const gt = toJsonSchema(object({ id: bigint().gt(0n) }), defOpts());
        expect(gt.properties?.['id']).toEqual({ type: 'integer', exclusiveMinimum: 0 });

        const lt = toJsonSchema(object({ id: bigint().lt(9999n) }), defOpts());
        expect(lt.properties?.['id']).toEqual({ type: 'integer', exclusiveMaximum: 9999 });

        const multiple = toJsonSchema(object({ even: bigint().multipleOf(2n) }), defOpts());
        expect(multiple.properties?.['even']).toEqual({ type: 'integer', multipleOf: 2 });
    });

    // z compatibility
    test('should support zodToJsonSchema alias', () => {
        // toJsonSchema is exported under the `zodToJsonSchema` alias for Zod compatibility.
        const basic = toJsonSchema(object({ name: string() }), defOpts());
        expect(basic).toEqual({
            type: 'object',
            properties: {
                name: { type: 'string' },
            },
            required: ['name'],
            additionalProperties: false,
        });

        const named = toJsonSchema(object({ name: string() }), 'User');
        const namedDefinitions = (named as JsonSchema & { definitions?: Record<string, JsonSchema> }).definitions;
        expect(named.$ref).toBe('#/definitions/User');
        expect(namedDefinitions).toBeDefined();
        expect(namedDefinitions?.['User']).toBeDefined();
    });

    test('should support object property constraints', () => {
        const minProps = toJsonSchema(
            object({
                data: object({}).minProperties(1),
            }),
            defOpts(),
        );
        const minDataSchema = minProps.properties?.['data'] as Record<string, unknown>;
        expect(minDataSchema['minProperties']).toBe(1);

        const maxProps = toJsonSchema(
            object({
                data: object({}).maxProperties(10),
            }),
            defOpts(),
        );
        const maxDataSchema = maxProps.properties?.['data'] as Record<string, unknown>;
        expect(maxDataSchema['maxProperties']).toBe(10);

        const both = toJsonSchema(
            object({
                data: object({}).minProperties(1).maxProperties(5),
            }),
            defOpts(),
        );
        const bothDataSchema = both.properties?.['data'] as Record<string, unknown>;
        expect(bothDataSchema['minProperties']).toBe(1);
        expect(bothDataSchema['maxProperties']).toBe(5);
    });

    // fromJsonSchema - JSON Schema to Validator conversion
    // Helper function to parse data with the result from fromJsonSchema
    function parseWith<T>(validatorOrSchema: ReturnType<typeof fromJsonSchema>, data: unknown): T {
        // fromJsonSchema always returns a ValueValidator now
        // Use valueOf() method that all ValueValidators have
        return Object(validatorOrSchema).parse(data) as T;
    }

    test('should convert string schema', () => {
        const schema = {
            type: 'string' as const,
        };
        const validator = fromJsonSchema(schema);
        expect(validator);
        expect(parseWith(validator, 'hello'), 'hello');
    });

    test('should convert number schema', () => {
        const schema = {
            type: 'number' as const,
        };
        const validator = fromJsonSchema(schema);
        expect(parseWith<number>(validator, 42)).toBe(42);
        expect(parseWith<number>(validator, 3.14)).toBe(3.14);
    });

    test('should convert integer schema', () => {
        const schema = {
            type: 'integer' as const,
        };
        const validator = fromJsonSchema(schema);
        expect(parseWith<number>(validator, 42)).toBe(42);
    });

    test('should convert boolean schema', () => {
        const schema = {
            type: 'boolean' as const,
        };
        const validator = fromJsonSchema(schema);
        expect(parseWith<boolean>(validator, true)).toBe(true);
        expect(parseWith<boolean>(validator, false)).toBe(false);
    });

    test('should convert null schema', () => {
        const schema = {
            type: 'null' as const,
        };
        const validator = fromJsonSchema(schema);
        expect(parseWith<null>(validator, null)).toBe(null);
    });

    test('should apply minLength constraint', () => {
        const schema = {
            type: 'string' as const,
            minLength: 3,
        };
        const validator = fromJsonSchema(schema);
        expect(parseWith(validator, 'hello'), 'hello');
        expect(() => parseWith(validator, 'ab')); // Should throw
    });

    test('should apply maxLength constraint', () => {
        const schema = {
            type: 'string' as const,
            maxLength: 5,
        };
        const validator = fromJsonSchema(schema);
        expect(parseWith(validator, 'hello'), 'hello');
    });

    test('should apply pattern constraint', () => {
        const schema = {
            type: 'string' as const,
            pattern: '^[a-z]+$',
        };
        const validator = fromJsonSchema(schema);
        expect(parseWith(validator, 'hello'), 'hello');
    });

    test('should apply format constraints', () => {
        const emailSchema = {
            type: 'string' as const,
            format: 'email' as const,
        } as const;
        const emailValidator = fromJsonSchema(emailSchema);
        expect(parseWith(emailValidator, 'test@example.com'), 'test@example.com');

        const urlSchema = {
            type: 'string' as const,
            format: 'url' as const,
        } as const;
        const urlValidator = fromJsonSchema(urlSchema);
        expect(parseWith(urlValidator, 'https://example.com'), 'https://example.com');
    });

    test('should apply date-time format constraints', () => {
        const dateTimeSchema = {
            type: 'string' as const,
            format: 'date-time' as const,
        };
        const dateTimeValidator = fromJsonSchema(dateTimeSchema);
        expect(parseWith(dateTimeValidator, '2023-10-24T12:30:00Z'), '2023-10-24T12:30:00Z');
        expect(parseWith(dateTimeValidator, '2023-10-24T12:30:00.123Z'), '2023-10-24T12:30:00.123Z');
        expect(parseWith(dateTimeValidator, '2023-10-24T12:30:00+05:30'), '2023-10-24T12:30:00+05:30');
        expect(() => parseWith(dateTimeValidator, '2023-10-24')).toThrow(/not a valid ISO 8601 datetime/);
        expect(() => parseWith(dateTimeValidator, 'not-a-datetime')).toThrow(/not a valid ISO 8601 datetime/);
    });

    test('should apply date format constraints', () => {
        const dateSchema = {
            type: 'string' as const,
            format: 'date' as const,
        };
        const dateValidator = fromJsonSchema(dateSchema);
        expect(parseWith(dateValidator, '2023-10-24'), '2023-10-24');
        expect(() => parseWith(dateValidator, '2023-10-24T12:30:00Z')).toThrow(/not a valid ISO 8601 date/);
        expect(() => parseWith(dateValidator, 'not-a-date')).toThrow(/not a valid ISO 8601 date/);
    });

    test('should apply time format constraints', () => {
        const timeSchema = {
            type: 'string' as const,
            format: 'time' as const,
        };
        const timeValidator = fromJsonSchema(timeSchema);
        expect(parseWith(timeValidator, '12:30:00'), '12:30:00');
        expect(parseWith(timeValidator, '12:30:00.123'), '12:30:00.123');
        expect(() => parseWith(timeValidator, '2023-10-24T12:30:00Z')).toThrow(/not a valid ISO 8601 time/);
        expect(() => parseWith(timeValidator, 'not-a-time')).toThrow(/not a valid ISO 8601 time/);
    });

    test('should apply minimum constraint', () => {
        const schema = {
            type: 'number' as const,
            minimum: 0,
        };
        const validator = fromJsonSchema(schema);
        expect(parseWith<number>(validator, 0)).toBe(0);
        expect(parseWith<number>(validator, 10)).toBe(10);
    });

    test('should apply maximum constraint', () => {
        const schema = {
            type: 'number' as const,
            maximum: 100,
        };
        const validator = fromJsonSchema(schema);
        expect(parseWith<number>(validator, 100)).toBe(100);
        expect(parseWith<number>(validator, 50)).toBe(50);
    });

    test('should apply exclusive bounds (draft 2020-12 style)', () => {
        const schema = {
            type: 'number' as const,
            exclusiveMinimum: 0,
            exclusiveMaximum: 100,
        };
        const validator = fromJsonSchema(schema);
        expect(parseWith<number>(validator, 50)).toBe(50);
    });

    test('should apply multipleOf constraint', () => {
        const schema = {
            type: 'number' as const,
            multipleOf: 5,
        };
        const validator = fromJsonSchema(schema);
        expect(parseWith<number>(validator, 10)).toBe(10);
        expect(parseWith<number>(validator, 15)).toBe(15);
    });

    test('should convert simple object schema', () => {
        const schema = {
            type: 'object' as const,
            properties: {
                name: { type: 'string' as const },
                age: { type: 'number' as const },
            },
            required: ['name', 'age'],
        };
        const validator = fromJsonSchema(schema);
        const result = parseWith<{ name: string; age: number }>(validator, { name: 'John', age: 30 });
        expect(result).toEqual({ name: 'John', age: 30 });
    });

    test('should handle optional properties', () => {
        const schema = {
            type: 'object' as const,
            properties: {
                name: { type: 'string' as const },
                age: { type: 'number' as const },
            },
            required: ['name'],
        };
        const validator = fromJsonSchema(schema);
        const result = parseWith<{ name: string }>(validator, { name: 'John' });
        expect(result.name === 'John');
    });

    test('should handle nested objects', () => {
        const schema = {
            type: 'object' as const,
            properties: {
                user: {
                    type: 'object' as const,
                    properties: {
                        name: { type: 'string' as const },
                        email: { type: 'string' as const, format: 'email' as const },
                    },
                    required: ['name', 'email'],
                },
            },
            required: ['user'],
        };
        const validator = fromJsonSchema(schema);
        const result = parseWith<{ user: { name: string } }>(validator, {
            user: { name: 'John', email: 'john@example.com' },
        });
        expect(result.user.name === 'John');
    });

    test('should convert array schema', () => {
        const schema = {
            type: 'array' as const,
            items: { type: 'string' as const },
        };
        const validator = fromJsonSchema(schema);
        const result = parseWith<string[]>(validator, ['a', 'b', 'c']);
        expect(result).toEqual(['a', 'b', 'c']);
    });

    test('should apply minItems constraint', () => {
        const schema = {
            type: 'array' as const,
            items: { type: 'string' as const },
            minItems: 2,
        };
        const validator = fromJsonSchema(schema);
        const result = parseWith<string[]>(validator, ['a', 'b']);
        expect(result).toEqual(['a', 'b']);
    });

    test('should apply maxItems constraint', () => {
        const schema = {
            type: 'array' as const,
            items: { type: 'number' as const },
            maxItems: 3,
        };
        const validator = fromJsonSchema(schema);
        const result = parseWith<number[]>(validator, [1, 2, 3]);
        expect(result).toEqual([1, 2, 3]);
    });

    test('should convert enum to literal union', () => {
        const schema = {
            enum: ['red', 'green', 'blue'],
        };
        const validator = fromJsonSchema(schema);
        expect(parseWith(validator, 'red'), 'red');
        expect(parseWith(validator, 'green'), 'green');
    });

    test('should handle single enum value', () => {
        const schema = {
            enum: ['only'],
        };
        const validator = fromJsonSchema(schema);
        expect(parseWith(validator, 'only'), 'only');
    });

    test('should handle numeric enum', () => {
        const schema = {
            enum: [1, 2, 3],
        };
        const validator = fromJsonSchema(schema);
        expect(parseWith<number>(validator, 1)).toBe(1);
        expect(parseWith<number>(validator, 2)).toBe(2);
    });

    test('should convert const to literal', () => {
        const schema = {
            const: 'fixed-value',
        };
        const validator = fromJsonSchema(schema);
        expect(parseWith(validator, 'fixed-value'), 'fixed-value');
    });

    test('should handle nullable type', () => {
        const schema = {
            type: ['string', 'null'] as ('string' | 'null')[],
        };
        const validator = fromJsonSchema(schema);
        expect(parseWith(validator, 'hello'), 'hello');
        expect(parseWith<null>(validator, null)).toBe(null);
    });

    test('should convert anyOf to union', () => {
        const schema = {
            anyOf: [{ type: 'string' as const }, { type: 'number' as const }],
        };
        const validator = fromJsonSchema(schema);
        expect(parseWith(validator, 'hello'), 'hello');
        expect(parseWith<number>(validator, 42)).toBe(42);
    });

    test('should convert oneOf to union', () => {
        const schema = {
            oneOf: [{ type: 'string' as const }, { type: 'number' as const }],
        };
        const validator = fromJsonSchema(schema);
        expect(parseWith(validator, 'hello'), 'hello');
        expect(parseWith<number>(validator, 42)).toBe(42);
    });

    test('should convert allOf with object schemas', () => {
        const schema = {
            allOf: [
                {
                    type: 'object' as const,
                    properties: { name: { type: 'string' as const } },
                    required: ['name'],
                },
                {
                    type: 'object' as const,
                    properties: { age: { type: 'number' as const } },
                    required: ['age'],
                },
            ] as JsonSchema[],
        } as const;
        const validator = fromJsonSchema(schema);
        const result = parseWith<{ name: string; age: number }>(validator, { name: 'John', age: 30 });
        expect(result.name === 'John' && result.age === 30);
    });

    test('should handle true schema (accepts anything)', () => {
        const trueSchema = true;
        const validator = fromJsonSchema(trueSchema);
        expect(parseWith<{ any: string }>(validator, { any: 'thing' })).toEqual({ any: 'thing' });
    });

    test('should accept draft 2019-09', () => {
        const schema = {
            // biome-ignore lint/style/useNamingConvention: JSON Schema standard property
            $schema: 'https://json-schema.org/draft/2019-09/schema',
            type: 'string' as const,
        };
        const validator = fromJsonSchema(schema);
        expect(validator);
    });

    test('should accept draft 2020-12', () => {
        const schema = {
            // biome-ignore lint/style/useNamingConvention: JSON Schema standard property
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'string' as const,
        };
        const validator = fromJsonSchema(schema);
        expect(validator);
    });

    test('should handle round-trip for basic types', () => {
        const original = object({
            name: string(),
            age: number().gte(0),
            active: boolean(),
        });

        const jsonSchema = toJsonSchema(original, {
            includeSchemaVersion: true,
            target: 'openApi3', // OpenAPI 3 uses draft 2020-12
        });
        const validator = fromJsonSchema(jsonSchema, { strictVersion: false });

        const testData = { name: 'John', age: 30, active: true };
        const result = parseWith<typeof testData>(validator, testData);
        expect(result).toEqual(testData);
    });

    test('should handle round-trip for nested objects', () => {
        const original = object({
            user: object({
                name: string(),
                email: string().email(),
            }),
        });

        const jsonSchema = toJsonSchema(original, {
            includeSchemaVersion: true,
            target: 'openApi3',
        });
        const validator = fromJsonSchema(jsonSchema, { strictVersion: false });

        const testData = { user: { name: 'John', email: 'john@example.com' } };
        const result = parseWith<{ user: { name: string } }>(validator, testData);
        expect(result.user.name === 'John');
    });

    test('should handle round-trip for arrays', () => {
        const original = object({
            tags: array(string()).minLength(1),
        });

        const jsonSchema = toJsonSchema(original, {
            includeSchemaVersion: true,
            target: 'openApi3',
        });
        const validator = fromJsonSchema(jsonSchema, { strictVersion: false });

        const testData = { tags: ['typescript', 'testing'] };
        const result = parseWith<{ tags: string[] }>(validator, testData);
        expect(result.tags).toEqual(testData.tags);
    });
});
