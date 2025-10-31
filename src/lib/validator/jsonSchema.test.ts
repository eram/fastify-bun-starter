import { deepEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fromJsonSchema, toJsonSchema } from './jsonSchema';
import {
    array,
    bigint,
    boolean,
    date,
    literal,
    map,
    nullable,
    nullish,
    number,
    object,
    set,
    string,
    union,
    z,
} from './jsonValidator';

const defOpts = (_t: it.SuiteContext) => ({ includeSchemaVersion: false });

describe('jsonSchema basic types', () => {
    it('should convert primitive types', (t) => {
        const result = toJsonSchema(
            {
                name: string(),
                age: number(),
                active: boolean(),
                count: bigint(),
                created: date(),
            },
            defOpts(t),
        );

        deepEqual(result, {
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

    it('should convert object schemas with nesting', (t) => {
        const simple = toJsonSchema(
            {
                name: string(),
                age: number(),
            },
            defOpts(t),
        );

        deepEqual(simple, {
            type: 'object',
            properties: {
                name: { type: 'string' },
                age: { type: 'number' },
            },
            required: ['name', 'age'],
            additionalProperties: false,
        });

        const nested = toJsonSchema(
            {
                user: object({
                    name: string(),
                    age: number(),
                }),
            },
            defOpts(t),
        );

        deepEqual(nested.properties?.user, {
            type: 'object',
            properties: {
                name: { type: 'string' },
                age: { type: 'number' },
            },
            required: ['name', 'age'],
            additionalProperties: false,
        });

        const deep = toJsonSchema(
            {
                data: object({
                    user: object({
                        profile: object({
                            name: string(),
                        }),
                    }),
                }),
            },
            defOpts(t),
        );

        ok(deep.properties?.data);
        const dataProps = (deep.properties.data as { properties?: Record<string, unknown> }).properties;
        ok(dataProps?.user);
        const userProps = (dataProps.user as { properties?: Record<string, unknown> }).properties;
        ok(userProps?.profile);
        deepEqual(userProps.profile, {
            type: 'object',
            properties: {
                name: { type: 'string' },
            },
            required: ['name'],
            additionalProperties: false,
        });
    });

    it('should handle optional properties', (t) => {
        const result = toJsonSchema(
            {
                name: string(),
                email: string().optional(),
            },
            defOpts(t),
        );

        deepEqual(result, {
            type: 'object',
            properties: {
                name: { type: 'string' },
                email: { type: 'string' },
            },
            required: ['name'],
            additionalProperties: false,
        });
    });

    it('should convert array types', (t) => {
        const strings = toJsonSchema({ tags: array(string()) }, defOpts(t));
        deepEqual(strings.properties?.tags, {
            type: 'array',
            items: { type: 'string' },
        });

        const numbers = toJsonSchema({ scores: array(number()) }, defOpts(t));
        deepEqual(numbers.properties?.scores, {
            type: 'array',
            items: { type: 'number' },
        });

        const objects = toJsonSchema(
            {
                users: array(object({ name: string(), age: number() })),
            },
            defOpts(t),
        );
        deepEqual(objects.properties?.users, {
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

        const generic = toJsonSchema({ items: array() }, defOpts(t));
        deepEqual(generic.properties?.items, { type: 'array' });

        const nested = toJsonSchema({ matrix: array(array(number())) }, defOpts(t));
        deepEqual(nested.properties?.matrix, {
            type: 'array',
            items: {
                type: 'array',
                items: { type: 'number' },
            },
        });
    });

    it('should convert union types', (t) => {
        const primitives = toJsonSchema(
            {
                value: union([string(), number()]),
            },
            defOpts(t),
        );
        deepEqual(primitives.properties?.value, {
            type: ['string', 'number'],
        });

        const withBoolean = toJsonSchema(
            {
                flag: union([string(), boolean()]),
            },
            defOpts(t),
        );
        deepEqual(withBoolean.properties?.flag, {
            type: ['string', 'boolean'],
        });

        const three = toJsonSchema(
            {
                data: union([string(), number(), boolean()]),
            },
            defOpts(t),
        );
        deepEqual(three.properties?.data, {
            type: ['string', 'number', 'boolean'],
        });

        const optional = toJsonSchema(
            {
                value: union([string(), number()]).optional(),
            },
            defOpts(t),
        );
        deepEqual(optional.properties?.value, {
            type: ['string', 'number'],
        });
        deepEqual(optional.required, []);
    });

    it('should convert literal types', (t) => {
        const stringLit = toJsonSchema({ status: literal('pending') }, defOpts(t));
        deepEqual(stringLit.properties?.status, {
            type: 'string',
            const: 'pending',
        });

        const numberLit = toJsonSchema({ code: literal(404) }, defOpts(t));
        deepEqual(numberLit.properties?.code, {
            type: 'number',
            const: 404,
        });

        const boolLit = toJsonSchema({ enabled: literal(true) }, defOpts(t));
        deepEqual(boolLit.properties?.enabled, {
            type: 'boolean',
            const: true,
        });

        const nullLit = toJsonSchema({ data: literal(null) }, defOpts(t));
        deepEqual(nullLit.properties?.data, {
            type: 'null',
        });
    });

    it('should convert nullable types', (t) => {
        const str = toJsonSchema({ name: nullable(string()) }, defOpts(t));
        deepEqual(str.properties?.name, {
            type: ['string', 'null'],
        });

        const num = toJsonSchema({ count: nullable(number()) }, defOpts(t));
        deepEqual(num.properties?.count, {
            type: ['number', 'null'],
        });

        const bool = toJsonSchema({ active: nullable(boolean()) }, defOpts(t));
        deepEqual(bool.properties?.active, {
            type: ['boolean', 'null'],
        });

        const arr = toJsonSchema({ tags: nullable(array(string())) }, defOpts(t));
        deepEqual(arr.properties?.tags, {
            anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
        });

        const optNull = toJsonSchema({ name: nullable(string()).optional() }, defOpts(t));
        deepEqual(optNull.properties?.name, {
            type: ['string', 'null'],
        });
        deepEqual(optNull.required, []);
    });

    it('should convert nullish types', (t) => {
        const str = toJsonSchema({ name: nullish(string()) }, defOpts(t));
        deepEqual(str.properties?.name, {
            type: ['string', 'null'],
        });
        deepEqual(str.required, []);

        const num = toJsonSchema({ age: nullish(number()) }, defOpts(t));
        deepEqual(num.properties?.age, {
            type: ['number', 'null'],
        });
        deepEqual(num.required, []);
    });

    it('should convert set and map types', (t) => {
        const setStr = toJsonSchema({ tags: set(string()) }, defOpts(t));
        deepEqual(setStr.properties?.tags, {
            type: 'array',
            uniqueItems: true,
            items: { type: 'string' },
        });

        const setNum = toJsonSchema({ ids: set(number()) }, defOpts(t));
        deepEqual(setNum.properties?.ids, {
            type: 'array',
            uniqueItems: true,
            items: { type: 'number' },
        });

        const setGen = toJsonSchema({ values: set() }, defOpts(t));
        deepEqual(setGen.properties?.values, {
            type: 'array',
            uniqueItems: true,
        });

        const mapStr = toJsonSchema({ metadata: map(string()) }, defOpts(t));
        deepEqual(mapStr.properties?.metadata, {
            type: 'object',
            additionalProperties: { type: 'string' },
        });

        const mapNum = toJsonSchema({ counters: map(number()) }, defOpts(t));
        deepEqual(mapNum.properties?.counters, {
            type: 'object',
            additionalProperties: { type: 'number' },
        });

        const mapGen = toJsonSchema({ data: map() }, defOpts(t));
        deepEqual(mapGen.properties?.data, {
            type: 'object',
            additionalProperties: true,
        });
    });
});

describe('Json schema builup', () => {
    it('should control schema version inclusion and targets', (t) => {
        const withVersion = toJsonSchema({ name: string() }, { ...defOpts(t), includeSchemaVersion: true });
        strictEqual(withVersion.$schema, 'http://json-schema.org/draft-07/schema#');

        const schema2019 = toJsonSchema(
            { name: string() },
            { ...defOpts(t), includeSchemaVersion: true, target: 'jsonSchema2019-09' },
        );
        strictEqual(schema2019.$schema, 'https://json-schema.org/draft/2019-09/schema');

        const schema2020 = toJsonSchema(
            { name: string() },
            { ...defOpts(t), includeSchemaVersion: true, target: 'jsonSchema2020-12' },
        );
        strictEqual(schema2020.$schema, 'https://json-schema.org/draft/2020-12/schema');

        const openApi = toJsonSchema({ name: string() }, { ...defOpts(t), includeSchemaVersion: true, target: 'openApi3' });
        strictEqual(openApi.$schema, undefined);

        const noVersion = toJsonSchema({ name: string() });
        strictEqual(noVersion.$schema, undefined);
    });

    it('should handle naming and definition paths', (t) => {
        const withName = toJsonSchema({ name: string() }, { name: 'User', title: 'USER' });
        strictEqual(withName.$ref, '#/definitions/User');
        ok((withName as Record<string, unknown>).definitions);
        ok(((withName as Record<string, unknown>).definitions as Record<string, unknown>).User);

        const customPath = toJsonSchema(
            { name: string() },
            { ...defOpts(t), name: 'User', definitionPath: 'definitions', includeSchemaVersion: false },
        ) as Record<string, unknown>;
        strictEqual(customPath.$ref, '#/definitions/User');
        ok(customPath.definitions);
        ok((customPath.definitions as Record<string, unknown>).User);

        const stringAsName = toJsonSchema({ name: string() }, 'User');
        strictEqual(stringAsName.$ref, '#/definitions/User');
        ok((stringAsName as Record<string, unknown>).definitions);
        ok(((stringAsName as Record<string, unknown>).definitions as Record<string, unknown>).User);
    });

    it('should control additional properties', (t) => {
        const allowed = toJsonSchema(
            { name: string() },
            { ...defOpts(t), includeSchemaVersion: false, additionalProperties: true },
        );
        strictEqual(allowed.additionalProperties, true);

        const disallowed = toJsonSchema({ name: string() }, defOpts(t));
        strictEqual(disallowed.additionalProperties, false);
    });

    it('should convert complex schemas', (t) => {
        const userSchema = toJsonSchema(
            {
                id: number(),
                name: string(),
                email: string().optional(),
                roles: array(string()),
                isActive: boolean(),
            },
            { ...defOpts(t), includeSchemaVersion: false },
        );

        deepEqual(userSchema, {
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
            {
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
            },
            defOpts(t),
        );

        ok(nested.properties?.company);
        const companyProps = (nested.properties.company as { properties?: Record<string, unknown> }).properties;
        ok(companyProps?.employees);
        const empItems = (companyProps.employees as { items?: Record<string, unknown> }).items;
        deepEqual(empItems, {
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
            {
                id: number(),
                name: string(),
                tags: set(string()),
                metadata: map(string()),
                status: literal('active'),
                count: nullable(number()),
                optional: string().optional(),
            },
            defOpts(t),
        );

        strictEqual(mixed.required?.length, 6);
        deepEqual(mixed.properties?.status, {
            type: 'string',
            const: 'active',
        });
    });

    it('should handle edge cases', (t) => {
        const empty = toJsonSchema({}, defOpts(t));
        deepEqual(empty, {
            type: 'object',
            properties: {},
            required: [],
            additionalProperties: false,
        });
    });

    it('should include descriptions', (t) => {
        const simple = toJsonSchema(
            {
                name: string().describe('The user name'),
            },
            defOpts(t),
        );
        ok(simple.properties);
        deepEqual(simple.properties.name, {
            type: 'string',
            description: 'The user name',
        });

        const withConstraints = toJsonSchema(
            {
                age: number().min(0).max(120).describe('Age in years'),
            },
            defOpts(t),
        );
        ok(withConstraints.properties);
        deepEqual(withConstraints.properties.age, {
            type: 'number',
            minimum: 0,
            maximum: 120,
            description: 'Age in years',
        });
    });
});

describe('type constraints', () => {
    it('should include number constraints', (t) => {
        const min = toJsonSchema({ age: number().min(18) }, defOpts(t));
        deepEqual(min.properties?.age, { type: 'number', minimum: 18 });

        const max = toJsonSchema({ age: number().max(65) }, defOpts(t));
        deepEqual(max.properties?.age, { type: 'number', maximum: 65 });

        const gtNum = toJsonSchema({ score: number().gt(0) }, defOpts(t));
        deepEqual(gtNum.properties?.score, { type: 'number', exclusiveMinimum: 0 });

        const ltNum = toJsonSchema({ score: number().lt(100) }, defOpts(t));
        deepEqual(ltNum.properties?.score, { type: 'number', exclusiveMaximum: 100 });

        const multiple = toJsonSchema({ price: number().multipleOf(0.01) }, defOpts(t));
        deepEqual(multiple.properties?.price, { type: 'number', multipleOf: 0.01 });

        const combined = toJsonSchema(
            {
                percentage: number().min(0).max(100).multipleOf(0.1),
            },
            defOpts(t),
        );
        deepEqual(combined.properties?.percentage, {
            type: 'number',
            minimum: 0,
            maximum: 100,
            multipleOf: 0.1,
        });
    });

    it('should include string constraints', (t) => {
        const min = toJsonSchema({ name: string().min(3) }, defOpts(t));
        deepEqual(min.properties?.name, { type: 'string', minLength: 3 });

        const max = toJsonSchema({ name: string().max(50) }, defOpts(t));
        deepEqual(max.properties?.name, { type: 'string', maxLength: 50 });

        const pattern = toJsonSchema({ code: string().regex(/^[A-Z]{3}$/) }, defOpts(t));
        deepEqual(pattern.properties?.code, { type: 'string', pattern: '^[A-Z]{3}$' });

        const combined = toJsonSchema(
            {
                username: string()
                    .min(3)
                    .max(20)
                    .regex(/^[a-z0-9_]+$/),
            },
            defOpts(t),
        );
        deepEqual(combined.properties?.username, {
            type: 'string',
            minLength: 3,
            maxLength: 20,
            pattern: '^[a-z0-9_]+$',
        });
    });

    it('should include array constraints', (t) => {
        const min = toJsonSchema({ tags: array(string()).minLength(1) }, defOpts(t));
        deepEqual(min.properties?.tags, {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
        });

        const max = toJsonSchema({ tags: array(string()).maxLength(10) }, defOpts(t));
        deepEqual(max.properties?.tags, {
            type: 'array',
            items: { type: 'string' },
            maxItems: 10,
        });

        const combined = toJsonSchema(
            {
                items: array(number()).minLength(1).maxLength(100),
            },
            defOpts(t),
        );
        deepEqual(combined.properties?.items, {
            type: 'array',
            items: { type: 'number' },
            minItems: 1,
            maxItems: 100,
        });
    });

    it('should include default values', (t) => {
        const simple = toJsonSchema(
            {
                status: string().default('pending'),
            },
            defOpts(t),
        );
        deepEqual(simple.properties?.status, {
            type: 'string',
            default: 'pending',
        });

        const withConstraints = toJsonSchema(
            {
                count: number().min(0).max(100).default(0),
            },
            defOpts(t),
        );
        deepEqual(withConstraints.properties?.count, {
            type: 'number',
            minimum: 0,
            maximum: 100,
            default: 0,
        });
    });

    it('should include bigint constraints', (t) => {
        const min = toJsonSchema({ count: bigint().min(0n) }, defOpts(t));
        deepEqual(min.properties?.count, { type: 'integer', minimum: 0 });

        const max = toJsonSchema({ count: bigint().max(1000n) }, defOpts(t));
        deepEqual(max.properties?.count, { type: 'integer', maximum: 1000 });

        const gt = toJsonSchema({ id: bigint().gt(0n) }, defOpts(t));
        deepEqual(gt.properties?.id, { type: 'integer', exclusiveMinimum: 0 });

        const lt = toJsonSchema({ id: bigint().lt(9999n) }, defOpts(t));
        deepEqual(lt.properties?.id, { type: 'integer', exclusiveMaximum: 9999 });

        const multiple = toJsonSchema({ even: bigint().multipleOf(2n) }, defOpts(t));
        deepEqual(multiple.properties?.even, { type: 'integer', multipleOf: 2 });
    });
});

describe('z compatibility', () => {
    it('should support zodToJsonSchema alias and z.* methods', (t) => {
        const basic = z.zodToJsonSchema({ name: z.string() }, defOpts(t));
        deepEqual(basic, {
            type: 'object',
            properties: {
                name: { type: 'string' },
            },
            required: ['name'],
            additionalProperties: false,
        });

        const named = z.zodToJsonSchema({ name: z.string() }, 'User');
        strictEqual(named.$ref, '#/definitions/User');
        ok((named as Record<string, unknown>).definitions);
        ok(((named as Record<string, unknown>).definitions as Record<string, unknown>).User);
    });

    it('should support object property constraints', (t) => {
        const minProps = z.zodToJsonSchema(
            {
                data: z.object({}).minProperties(1),
            },
            defOpts(t),
        );
        const minDataSchema = minProps.properties?.data as Record<string, unknown>;
        strictEqual(minDataSchema.minProperties, 1);

        const maxProps = z.zodToJsonSchema(
            {
                data: z.object({}).maxProperties(10),
            },
            defOpts(t),
        );
        const maxDataSchema = maxProps.properties?.data as Record<string, unknown>;
        strictEqual(maxDataSchema.maxProperties, 10);

        const both = z.zodToJsonSchema(
            {
                data: z.object({}).minProperties(1).maxProperties(5),
            },
            defOpts(t),
        );
        const bothDataSchema = both.properties?.data as Record<string, unknown>;
        strictEqual(bothDataSchema.minProperties, 1);
        strictEqual(bothDataSchema.maxProperties, 5);
    });
});

describe('fromJsonSchema - JSON Schema to Validator conversion', () => {
    // Helper function to parse data with the result from fromJsonSchema
    function parseWith<T>(validatorOrSchema: ReturnType<typeof fromJsonSchema>, data: unknown): T {
        // fromJsonSchema always returns a ValueValidator now
        // Use valueOf() method that all ValueValidators have
        // biome-ignore lint/suspicious/noExplicitAny: Test helper needs flexibility
        return (validatorOrSchema as any).valueOf(data) as T;
    }

    describe('basic types', () => {
        it('should convert string schema', () => {
            const schema = {
                type: 'string' as const,
            };
            const validator = fromJsonSchema(schema);
            ok(validator);
            strictEqual(parseWith(validator, 'hello'), 'hello');
        });

        it('should convert number schema', () => {
            const schema = {
                type: 'number' as const,
            };
            const validator = fromJsonSchema(schema);
            strictEqual(parseWith(validator, 42), 42);
            strictEqual(parseWith(validator, 3.14), 3.14);
        });

        it('should convert integer schema', () => {
            const schema = {
                type: 'integer' as const,
            };
            const validator = fromJsonSchema(schema);
            strictEqual(parseWith(validator, 42), 42);
        });

        it('should convert boolean schema', () => {
            const schema = {
                type: 'boolean' as const,
            };
            const validator = fromJsonSchema(schema);
            strictEqual(parseWith(validator, true), true);
            strictEqual(parseWith(validator, false), false);
        });

        it('should convert null schema', () => {
            const schema = {
                type: 'null' as const,
            };
            const validator = fromJsonSchema(schema);
            strictEqual(parseWith(validator, null), null);
        });
    });

    describe('string constraints', () => {
        it('should apply minLength constraint', () => {
            const schema = {
                type: 'string' as const,
                minLength: 3,
            };
            const validator = fromJsonSchema(schema);
            strictEqual(parseWith(validator, 'hello'), 'hello');
            throws(() => parseWith(validator, 'ab')); // Should throw
        });

        it('should apply maxLength constraint', () => {
            const schema = {
                type: 'string' as const,
                maxLength: 5,
            };
            const validator = fromJsonSchema(schema);
            strictEqual(parseWith(validator, 'hello'), 'hello');
        });

        it('should apply pattern constraint', () => {
            const schema = {
                type: 'string' as const,
                pattern: '^[a-z]+$',
            };
            const validator = fromJsonSchema(schema);
            strictEqual(parseWith(validator, 'hello'), 'hello');
        });

        it('should apply format constraints', () => {
            const emailSchema = {
                type: 'string' as const,
                format: 'email' as const,
            };
            const emailValidator = fromJsonSchema(emailSchema);
            strictEqual(parseWith(emailValidator, 'test@example.com'), 'test@example.com');

            const urlSchema = {
                type: 'string' as const,
                format: 'url' as const,
            };
            const urlValidator = fromJsonSchema(urlSchema);
            strictEqual(parseWith(urlValidator, 'https://example.com'), 'https://example.com');
        });

        it('should apply date-time format constraints', () => {
            const dateTimeSchema = {
                type: 'string' as const,
                format: 'date-time' as const,
            };
            const dateTimeValidator = fromJsonSchema(dateTimeSchema);
            strictEqual(parseWith(dateTimeValidator, '2023-10-24T12:30:00Z'), '2023-10-24T12:30:00Z');
            strictEqual(parseWith(dateTimeValidator, '2023-10-24T12:30:00.123Z'), '2023-10-24T12:30:00.123Z');
            strictEqual(parseWith(dateTimeValidator, '2023-10-24T12:30:00+05:30'), '2023-10-24T12:30:00+05:30');
            throws(() => parseWith(dateTimeValidator, '2023-10-24'), /not a valid ISO 8601 datetime/);
            throws(() => parseWith(dateTimeValidator, 'not-a-datetime'), /not a valid ISO 8601 datetime/);
        });

        it('should apply date format constraints', () => {
            const dateSchema = {
                type: 'string' as const,
                format: 'date' as const,
            };
            const dateValidator = fromJsonSchema(dateSchema);
            strictEqual(parseWith(dateValidator, '2023-10-24'), '2023-10-24');
            throws(() => parseWith(dateValidator, '2023-10-24T12:30:00Z'), /not a valid ISO 8601 date/);
            throws(() => parseWith(dateValidator, 'not-a-date'), /not a valid ISO 8601 date/);
        });

        it('should apply time format constraints', () => {
            const timeSchema = {
                type: 'string' as const,
                format: 'time' as const,
            };
            const timeValidator = fromJsonSchema(timeSchema);
            strictEqual(parseWith(timeValidator, '12:30:00'), '12:30:00');
            strictEqual(parseWith(timeValidator, '12:30:00.123'), '12:30:00.123');
            throws(() => parseWith(timeValidator, '2023-10-24T12:30:00Z'), /not a valid ISO 8601 time/);
            throws(() => parseWith(timeValidator, 'not-a-time'), /not a valid ISO 8601 time/);
        });
    });

    describe('number constraints', () => {
        it('should apply minimum constraint', () => {
            const schema = {
                type: 'number' as const,
                minimum: 0,
            };
            const validator = fromJsonSchema(schema);
            strictEqual(parseWith(validator, 0), 0);
            strictEqual(parseWith(validator, 10), 10);
        });

        it('should apply maximum constraint', () => {
            const schema = {
                type: 'number' as const,
                maximum: 100,
            };
            const validator = fromJsonSchema(schema);
            strictEqual(parseWith(validator, 100), 100);
            strictEqual(parseWith(validator, 50), 50);
        });

        it('should apply exclusive bounds (draft 2020-12 style)', () => {
            const schema = {
                type: 'number' as const,
                exclusiveMinimum: 0,
                exclusiveMaximum: 100,
            };
            const validator = fromJsonSchema(schema);
            strictEqual(parseWith(validator, 50), 50);
        });

        it('should apply multipleOf constraint', () => {
            const schema = {
                type: 'number' as const,
                multipleOf: 5,
            };
            const validator = fromJsonSchema(schema);
            strictEqual(parseWith(validator, 10), 10);
            strictEqual(parseWith(validator, 15), 15);
        });
    });

    describe('object schemas', () => {
        it('should convert simple object schema', () => {
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
            deepEqual(result, { name: 'John', age: 30 });
        });

        it('should handle optional properties', () => {
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
            ok(result.name === 'John');
        });

        it('should handle nested objects', () => {
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
            ok(result.user.name === 'John');
        });
    });

    describe('array schemas', () => {
        it('should convert array schema', () => {
            const schema = {
                type: 'array' as const,
                items: { type: 'string' as const },
            };
            const validator = fromJsonSchema(schema);
            const result = parseWith<string[]>(validator, ['a', 'b', 'c']);
            deepEqual(result, ['a', 'b', 'c']);
        });

        it('should apply minItems constraint', () => {
            const schema = {
                type: 'array' as const,
                items: { type: 'string' as const },
                minItems: 2,
            };
            const validator = fromJsonSchema(schema);
            const result = parseWith<string[]>(validator, ['a', 'b']);
            deepEqual(result, ['a', 'b']);
        });

        it('should apply maxItems constraint', () => {
            const schema = {
                type: 'array' as const,
                items: { type: 'number' as const },
                maxItems: 3,
            };
            const validator = fromJsonSchema(schema);
            const result = parseWith<number[]>(validator, [1, 2, 3]);
            deepEqual(result, [1, 2, 3]);
        });
    });

    describe('enum schemas', () => {
        it('should convert enum to literal union', () => {
            const schema = {
                enum: ['red', 'green', 'blue'],
            };
            const validator = fromJsonSchema(schema);
            strictEqual(parseWith(validator, 'red'), 'red');
            strictEqual(parseWith(validator, 'green'), 'green');
        });

        it('should handle single enum value', () => {
            const schema = {
                enum: ['only'],
            };
            const validator = fromJsonSchema(schema);
            strictEqual(parseWith(validator, 'only'), 'only');
        });

        it('should handle numeric enum', () => {
            const schema = {
                enum: [1, 2, 3],
            };
            const validator = fromJsonSchema(schema);
            strictEqual(parseWith(validator, 1), 1);
            strictEqual(parseWith(validator, 2), 2);
        });
    });

    describe('const schemas', () => {
        it('should convert const to literal', () => {
            const schema = {
                const: 'fixed-value',
            };
            const validator = fromJsonSchema(schema);
            strictEqual(parseWith(validator, 'fixed-value'), 'fixed-value');
        });
    });

    describe('nullable schemas', () => {
        it('should handle nullable type', () => {
            const schema = {
                type: ['string', 'null'] as ('string' | 'null')[],
            };
            const validator = fromJsonSchema(schema);
            strictEqual(parseWith(validator, 'hello'), 'hello');
            strictEqual(parseWith(validator, null), null);
        });
    });

    describe('combinators', () => {
        it('should convert anyOf to union', () => {
            const schema = {
                anyOf: [{ type: 'string' as const }, { type: 'number' as const }],
            };
            const validator = fromJsonSchema(schema);
            strictEqual(parseWith(validator, 'hello'), 'hello');
            strictEqual(parseWith(validator, 42), 42);
        });

        it('should convert oneOf to union', () => {
            const schema = {
                oneOf: [{ type: 'string' as const }, { type: 'number' as const }],
            };
            const validator = fromJsonSchema(schema);
            strictEqual(parseWith(validator, 'hello'), 'hello');
            strictEqual(parseWith(validator, 42), 42);
        });

        it('should convert allOf with object schemas', () => {
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
                ],
            } as const;
            // biome-ignore lint/suspicious/noExplicitAny: Complex nested const schema type
            const validator = fromJsonSchema(schema as any);
            const result = parseWith<{ name: string; age: number }>(validator, { name: 'John', age: 30 });
            ok(result.name === 'John' && result.age === 30);
        });
    });

    describe('boolean schemas', () => {
        it('should handle true schema (accepts anything)', () => {
            const trueSchema = true;
            const validator = fromJsonSchema(trueSchema);
            ok(parseWith(validator, { any: 'thing' }));
        });
    });

    describe('version validation', () => {
        it('should accept draft 2019-09', () => {
            const schema = {
                // biome-ignore lint/style/useNamingConvention: JSON Schema standard property
                $schema: 'https://json-schema.org/draft/2019-09/schema',
                type: 'string' as const,
            };
            const validator = fromJsonSchema(schema);
            ok(validator);
        });

        it('should accept draft 2020-12', () => {
            const schema = {
                // biome-ignore lint/style/useNamingConvention: JSON Schema standard property
                $schema: 'https://json-schema.org/draft/2020-12/schema',
                type: 'string' as const,
            };
            const validator = fromJsonSchema(schema);
            ok(validator);
        });
    });

    describe('round-trip conversion', () => {
        it('should handle round-trip for basic types', () => {
            const original = {
                name: string(),
                age: number().gte(0),
                active: boolean(),
            };

            const jsonSchema = toJsonSchema(original, {
                includeSchemaVersion: true,
                target: 'openApi3', // OpenAPI 3 uses draft 2020-12
            });
            const validator = fromJsonSchema(jsonSchema, { strictVersion: false });

            const testData = { name: 'John', age: 30, active: true };
            const result = parseWith<typeof testData>(validator, testData);
            deepEqual(result, testData);
        });

        it('should handle round-trip for nested objects', () => {
            const original = {
                user: object({
                    name: string(),
                    email: string().email(),
                }),
            };

            const jsonSchema = toJsonSchema(original, {
                includeSchemaVersion: true,
                target: 'openApi3',
            });
            const validator = fromJsonSchema(jsonSchema, { strictVersion: false });

            const testData = { user: { name: 'John', email: 'john@example.com' } };
            const result = parseWith<{ user: { name: string } }>(validator, testData);
            ok(result.user.name === 'John');
        });

        it('should handle round-trip for arrays', () => {
            const original = {
                tags: array(string()).minLength(1),
            };

            const jsonSchema = toJsonSchema(original, {
                includeSchemaVersion: true,
                target: 'openApi3',
            });
            const validator = fromJsonSchema(jsonSchema, { strictVersion: false });

            const testData = { tags: ['typescript', 'testing'] };
            const result = parseWith<{ tags: string[] }>(validator, testData);
            deepEqual(result.tags, testData.tags);
        });
    });

    describe('Real-world JSON Schema - MCP Server Schema', () => {
        it('should import and validate MCP server schema', async () => {
            // Import the MCP (Model Context Protocol) server schema
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            const { fileURLToPath } = await import('node:url');

            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);
            const schemaPath = path.join(__dirname, '__mocks__', 'mcp-schema.json');
            const schemaContent = await fs.readFile(schemaPath, 'utf-8');
            const mcpSchema = JSON.parse(schemaContent);

            // Verify the schema has the expected structure
            ok(mcpSchema.$schema, 'Schema should have $schema property');
            ok(mcpSchema.definitions, 'Schema should have definitions');
            ok(Object.keys(mcpSchema.definitions).length > 50, 'Schema should have many definitions');

            // Test converting a specific definition to a validator
            const initializeRequestDef = mcpSchema.definitions.InitializeRequest;
            ok(initializeRequestDef, 'Should have InitializeRequest definition');

            // Convert the InitializeRequest schema to a validator
            const validator = fromJsonSchema(initializeRequestDef, { strictVersion: false });
            ok(validator, 'Should create validator from MCP schema definition');

            // Test with valid MCP InitializeRequest data
            const validRequest = {
                method: 'initialize',
                params: {
                    protocolVersion: '2025-06-18',
                    capabilities: {},
                    clientInfo: {
                        name: 'test-client',
                        version: '1.0.0',
                    },
                },
            };

            const result = parseWith<{ method: string; params: { protocolVersion: string } }>(validator, validRequest);
            strictEqual(result.method, 'initialize');
            strictEqual(result.params.protocolVersion, '2025-06-18');
        });

        it('should validate MCP Tool definition', async () => {
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            const { fileURLToPath } = await import('node:url');

            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);
            const schemaPath = path.join(__dirname, '__mocks__', 'mcp-schema.json');
            const schemaContent = await fs.readFile(schemaPath, 'utf-8');
            const mcpSchema = JSON.parse(schemaContent);

            const toolDef = mcpSchema.definitions.Tool;
            ok(toolDef, 'Should have Tool definition');

            const validator = fromJsonSchema(toolDef, { strictVersion: false });

            const validTool = {
                name: 'search',
                description: 'Search for information',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                        },
                    },
                },
            };

            const result = parseWith<{ name: string; description: string }>(validator, validTool);
            strictEqual(result.name, 'search');
            strictEqual(result.description, 'Search for information');
        });

        it('should validate MCP Resource definition', async () => {
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            const { fileURLToPath } = await import('node:url');

            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);
            const schemaPath = path.join(__dirname, '__mocks__', 'mcp-schema.json');
            const schemaContent = await fs.readFile(schemaPath, 'utf-8');
            const mcpSchema = JSON.parse(schemaContent);

            const resourceDef = mcpSchema.definitions.Resource;
            ok(resourceDef, 'Should have Resource definition');

            const validator = fromJsonSchema(resourceDef, { strictVersion: false });

            const validResource = {
                uri: 'file:///path/to/resource.txt',
                name: 'resource',
                mimeType: 'text/plain',
            };

            const result = parseWith<{ uri: string; name: string }>(validator, validResource);
            strictEqual(result.uri, 'file:///path/to/resource.txt');
            strictEqual(result.name, 'resource');
        });
    });
});
