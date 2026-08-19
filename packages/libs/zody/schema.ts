/**
 * JsonSchema - Convert validator schemas to JSON Schema (Draft 2020-12) and vice versa
 *
 * A zero-dependency implementation for converting between validator.ts schemas and JSON Schema format.
 * Focuses on modern JSON Schema standards without legacy compatibility concerns.
 *
 * @module jsonSchema
 */

import type { Validator, ValidatorDef } from './validator';
import * as v from './validator';
import { ArrV, type ObjV } from './validator';

// =================================
// Types
// =================================

// Schema type represents an object validator (aligned with Zod where z.object() returns ZodObject)
//export type Schema = ObjV<Record<string, Validator>>;
export type Schema<T extends Record<string, Validator> = Record<string, Validator>> = ObjV<T>;

// JsonSchema extends ValidatorDef and adds schema-composition properties
export type JsonSchema = Omit<ValidatorDef, 'value'> & {
    // Schema composition properties (not used by validators)
    allOf?: JsonSchema[];
    oneOf?: JsonSchema[];
    $ref?: string;
    $schema?: string;
    $defs?: Record<string, JsonSchema>;

    // Schema metadata properties
    title?: string;
};

class DefOptions {
    /** Name for the root schema (creates a $ref to $defs) */
    readonly name?: string = undefined;
    /** Title for the root schema (human-readable label) */
    readonly title?: string = undefined;
    /** Add $schema property (default: false) */
    readonly includeSchemaVersion: boolean = false;
    /** Target schema version (default: 'jsonSchema7') */
    readonly target: 'jsonSchema7' | 'jsonSchema2019-09' | 'jsonSchema2020-12' | 'openApi3' = 'jsonSchema7';
    /** Strategy for handling $refs: root, relative, seen, or none (default: 'root') */
    readonly $refStrategy: 'root' | 'relative' | 'seen' | 'none' = 'root';
    /** Base path for $refs (default: ['#']) */
    readonly basePath: string[] = ['#'];
    /** Definition path key (default: 'definitions') */
    readonly definitionPath: '$defs' | 'definitions' = 'definitions';
    /** Allow additional properties by default (default: false) */
    readonly additionalProperties: boolean = false;
    /** Pre-defined schemas to reference (default: {}) */
    readonly definitions: Record<string, Schema> = {};
}

export type ToJsonSchemaOptions = Partial<DefOptions>;

interface Refs {
    seen: Map<unknown, SeenItem>;
    currentPath: string[];
    options: Required<ToJsonSchemaOptions>;
}

interface SeenItem {
    def: unknown;
    path: string[];
    schema?: JsonSchema;
}

/// ============================================================================
// Main Export
// ============================================================================

/**
 * Convert a validator schema to JSON Schema format
 *
 * @param schema - The validator schema to convert
 * @param options - Conversion options
 * @returns JSON Schema representation
 *
 * @example
 * ```ts
 * import { object, string, number } from './jsonValidator';
 * import { toJsonSchema } from './jsonSchema';
 *
 * const schema = {
 *   name: string().min(1),
 *   age: number().int().positive(),
 * };
 *
 * const jsonSchema = toJsonSchema(schema);
 * ```
 */
export function toJsonSchema<T extends Record<string, Validator>>(
    schema: Schema<T>,
    options?: ToJsonSchemaOptions | string,
): JsonSchema {
    const opts = (
        typeof options === 'string' ? { ...new DefOptions(), name: options } : { ...new DefOptions(), ...options }
    ) as Required<ToJsonSchemaOptions>;

    const refs: Refs = {
        seen: new Map(),
        currentPath: opts.name ? [...opts.basePath, opts.definitionPath, opts.name] : opts.basePath,
        options: opts,
    };

    // Pre-populate seen map with definitions
    if (opts.definitions) {
        for (const [name, def] of Object.entries(opts.definitions)) {
            refs.seen.set(def, {
                def,
                path: [...opts.basePath, opts.definitionPath, name],
            });
        }
    }

    // Parse definitions first
    // biome-ignore lint/style/useNamingConvention: JSON Schema property name
    let $defs: Record<string, JsonSchema> | undefined;
    if (opts.definitions && Object.keys(opts.definitions).length > 0) {
        $defs = {};
        for (const [name, def] of Object.entries(opts.definitions)) {
            const defRefs = {
                ...refs,
                currentPath: [...opts.basePath, opts.definitionPath, name],
            };
            $defs[name] = parseSchema(def, defRefs);
        }
    }

    // Parse main schema
    const mainSchema = parseSchema(schema, refs);

    // Build final schema
    let result: JsonSchema;

    if (opts.name) {
        // Named schema with $ref
        result = {
            // biome-ignore lint/style/useNamingConvention: JSON Schema property name
            $ref: [...opts.basePath, opts.definitionPath, opts.name].join('/'),
        };
        if (!$defs) {
            $defs = {};
        }
        $defs[opts.name] = mainSchema;
    } else {
        result = mainSchema;
    }

    // Add definitions
    if ($defs && Object.keys($defs).length > 0) {
        Object(result)[opts.definitionPath] = $defs;
    }

    // Add schema version based on target
    if (opts.includeSchemaVersion) {
        switch (opts.target) {
            case 'jsonSchema7':
                result.$schema = 'http://json-schema.org/draft-07/schema#';
                break;
            case 'jsonSchema2019-09':
                result.$schema = 'https://json-schema.org/draft/2019-09/schema';
                break;
            case 'jsonSchema2020-12':
                result.$schema = 'https://json-schema.org/draft/2020-12/schema';
                break;
            case 'openApi3':
                // OpenAPI 3.0 doesn't use $schema
                break;
        }
    }

    // Add title
    if (opts.title) {
        result.title = opts.title;
    }

    return result;
}

// ============================================================================
// Core Parser
// ============================================================================

/**
 * Parse a validator schema (ObjV instance or plain object with validators)
 */
function parseSchema<T extends Record<string, Validator>>(schema: Schema<T> | Record<string, Validator>, refs: Refs): JsonSchema {
    // Check if schema is a validator instance (ObjV) or a plain object
    const isObjVInstance = isValidator(schema);

    let schemaDef: JsonSchema | undefined;
    let schemaProps: Record<string, Validator>;

    if (isObjVInstance) {
        // Get the validator defs which includes minProperties, maxProperties, etc.
        schemaDef = parseValidator(schema as Schema, refs);

        // Extract the actual schema object from the ObjV instance
        // ObjV stores the schema in a private _schema property
        schemaProps = Object(schema)._schema;
    } else {
        // Plain object with validators
        schemaProps = schema as Record<string, Validator>;
    }

    // Start with properties from the validator defs if available
    const result = (schemaDef ? { ...schemaDef } : { type: 'object' }) as Record<string, unknown>;
    result['properties'] = {};
    result['required'] = [];

    for (const [key, propValidator] of Object.entries(schemaProps)) {
        const savedPath = refs.currentPath;
        refs.currentPath = [...savedPath, 'properties', key];

        (result['properties'] as Record<string, JsonSchema>)[key] = parseValidator(propValidator, refs);

        // Check if optional
        if (!propValidator.isOptional) {
            (result['required'] as string[]).push(key);
        }

        refs.currentPath = savedPath;
    }

    // Keep required array even if empty (JSON Schema spec allows it)

    // Set additionalProperties based on context
    result['additionalProperties'] = refs.options.additionalProperties;

    return result as JsonSchema;
}

/**
 * Parse a single validator - converts ValidatorDef to JsonSchema by omitting metadata
 */
function parseValidator(validator: Validator, refs: Refs): JsonSchema {
    // Check if validator has defs method
    if (!validator || typeof validator !== 'object' || !('defs' in validator) || typeof validator.defs !== 'function') {
        throw new Error(`Invalid validator: expected object with defs() method, got ${typeof validator}`);
    }

    // Use def() method which returns ValidatorDef
    const def = validator.defs(refs.options.additionalProperties);

    // Recursively clean ValidatorDef-specific properties from nested structures
    return cleanValidatorDef(def);
}

/**
 * Recursively clean ValidatorDef objects from nested structures
 */
function cleanValidatorDef(obj: unknown): JsonSchema {
    if (!obj || typeof obj !== 'object') {
        return obj as JsonSchema;
    }

    if (Array.isArray(obj)) {
        // Clean each item in the array (removing ValidatorDef properties)
        return obj.map((item) => {
            if (item && typeof item === 'object' && !Array.isArray(item)) {
                // Remove ValidatorDef properties from each object in array
                const { value, ...rest } = item as Record<string, unknown>;
                return cleanValidatorDef(rest);
            }
            return cleanValidatorDef(item);
        }) as unknown as JsonSchema;
    }

    // Strip 'value' from the current object and recursively clean nested properties
    const { value, ...objWithoutValue } = obj as Record<string, unknown>;

    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(objWithoutValue)) {
        if (val === undefined) {
            continue;
        }

        // Recursively clean nested objects and arrays
        if (val && typeof val === 'object') {
            if (Array.isArray(val)) {
                // Clean array items (this handles anyOf, allOf, oneOf, etc.)
                result[key] = val.map((item) => {
                    if (item && typeof item === 'object' && !Array.isArray(item)) {
                        const { value: itemValue, ...rest } = item as Record<string, unknown>;
                        return cleanValidatorDef(rest);
                    }
                    return cleanValidatorDef(item);
                });
            } else {
                // For nested objects (like items, properties[key], additionalProperties), recursively clean
                result[key] = cleanValidatorDef(val);
            }
        } else {
            result[key] = val;
        }
    }

    return result as JsonSchema;
}

// ============================================================================
// JSON Schema to Validator Converter
// ============================================================================

class DefFromJsonSchemaOptions {
    /** Allow additional properties by default (for object schemas) (default: false) */
    readonly additionalProperties: boolean = false;
    /** Only accept modern JSON Schema versions (draft 2019-09 or 2020-12) (default: true) */
    readonly strictVersion: boolean = true;
}

export type FromJsonSchemaOptions = Partial<DefFromJsonSchemaOptions>;

/**
 * Convert a JSON Schema to a validator schema
 *
 * Supports modern JSON Schema drafts (2019-09, 2020-12).
 * For older drafts, set strictVersion: false (but behavior may be incomplete).
 *
 * @param jsonSchema - The JSON Schema to convert
 * @param options - Conversion options
 * @returns Validator schema
 *
 * @example
 * ```ts
 * import { fromJsonSchema } from './jsonSchema';
 *
 * const jsonSchema = {
 *   type: 'object',
 *   properties: {
 *     name: { type: 'string', minLength: 1 },
 *     age: { type: 'integer', minimum: 0 },
 *   },
 *   required: ['name'],
 * };
 *
 * const schema = fromJsonSchema(jsonSchema);
 * // Returns: { name: string().min(1), age: number().int().min(0).optional() }
 * ```
 */
export function fromJsonSchema(jsonSchema: Readonly<JsonSchema> | boolean, options?: FromJsonSchemaOptions): Validator {
    const opts = { ...new DefFromJsonSchemaOptions(), ...options };

    // Validate schema version if strictVersion is enabled
    if (opts.strictVersion && typeof jsonSchema === 'object' && jsonSchema.$schema) {
        const version = jsonSchema.$schema;
        const isModern = version.includes('2019-09') || version.includes('2020-12');
        if (!isModern) {
            throw new Error(
                `Only JSON Schema draft 2019-09 and 2020-12 are supported. Got: ${version}. Set strictVersion: false to bypass this check.`,
            );
        }
    }

    // Handle boolean schemas
    if (typeof jsonSchema === 'boolean') {
        // true = any schema, false = never schema
        // Since we don't have any() or never(), use literal for approximation
        if (jsonSchema) {
            // Accept any value - use object with no constraints
            return v.object({});
        }
        // Never match - use literal with impossible value
        throw new Error('Boolean schema "false" (never) not directly supported');
    }

    // Handle $ref (basic support)
    if (jsonSchema.$ref) {
        throw new Error('$ref resolution not yet supported. Pre-resolve $refs before calling fromJsonSchema().');
    }

    return parseJsonSchema(jsonSchema, opts);
}

/**
 * Parse JSON Schema object and dispatch to appropriate parser
 */
function parseJsonSchema(schema: JsonSchema, opts: Required<FromJsonSchemaOptions>): Validator {
    // Handle schema combinators first
    if (schema['anyOf']) {
        return parseAnyOf(schema['anyOf'], opts);
    }

    if (schema.oneOf) {
        return parseOneOf(schema.oneOf, opts);
    }

    if (schema.allOf) {
        return parseAllOf(schema.allOf, opts);
    }

    // Handle not (negation)
    if (schema['not']) {
        throw new Error('JSON Schema "not" combinator not supported in validator conversion');
    }

    // Handle enum
    if (schema['enum']) {
        return parseEnum(schema['enum']);
    }

    // Handle const
    if (schema['const'] !== undefined) {
        const constValue = schema['const'];
        // Ensure const value is a valid literal type
        if (
            typeof constValue === 'string' ||
            typeof constValue === 'number' ||
            typeof constValue === 'boolean' ||
            constValue === null
        ) {
            return v.literal(constValue as string | number | boolean | null);
        }
        if (constValue === undefined) {
            return v.literal(undefined);
        }
        // For complex objects, we can't create a literal - use object validator
        throw new Error('Complex const values (objects/arrays) not supported');
    }

    // Handle nullable (OpenAPI / older JSON Schema)
    if ((schema as { nullable?: boolean }).nullable === true) {
        const baseType = schema['type'];
        if (!baseType) {
            throw new Error('nullable requires a type property');
        }
        const baseSchema = parseJsonSchema({ ...schema, nullable: undefined } as JsonSchema, opts);
        if (isValidator(baseSchema)) {
            return v.nullish(baseSchema);
        }
        throw new Error('nullable only works with primitive types');
    }

    // Handle type-based dispatch
    const type = schema['type'];

    if (!type) {
        // No type specified - return empty object schema
        return v.object({});
    }

    // Handle multiple types (e.g., type: ["string", "number"])
    if (Array.isArray(type)) {
        return parseMultipleTypes(type as string[], schema, opts);
    }

    // Single type dispatch
    switch (type) {
        case 'object': {
            const objSchema = parseObjectSchema(schema, opts);
            return v.object(objSchema);
        }
        case 'array':
            return parseArraySchema(schema, opts);
        case 'string':
            return parseStringSchema(schema);
        case 'number':
        case 'integer':
            return parseNumberSchema(schema);
        case 'boolean':
            return v.boolean();
        case 'null':
            return v.literal(null);
        default:
            // Unknown type - return empty object
            return v.object({});
    }
}

/**
 * Parse object schema
 */
function parseObjectSchema(schema: JsonSchema, opts: Required<FromJsonSchemaOptions>): Record<string, Validator> {
    const result: Record<string, Validator> = {};

    const properties = schema['properties'] as Record<string, JsonSchema> | undefined;
    const required = schema['required'] as string[] | undefined;

    if (properties) {
        for (const [key, propSchema] of Object.entries(properties)) {
            const propValidator = parseJsonSchema(propSchema, opts);
            const isRequired = required?.includes(key);

            // propValidator is always a ValueValidator now
            result[key] = propValidator;
            if (!isRequired) {
                result[key].isOptional = true;
            }
        }
    }

    return result;
}

/**
 * Parse array schema
 */
function parseArraySchema(schema: JsonSchema, opts: Required<FromJsonSchemaOptions>): Validator {
    let validator: Validator = v.array();

    // Handle items schema
    if (schema['items']) {
        const itemsSchema = parseJsonSchema(schema['items'] as JsonSchema, opts);
        if (isValidator(itemsSchema)) {
            validator = v.array(itemsSchema);
        } else {
            validator = v.array(v.object(itemsSchema));
        }
    }

    // Add constraints (arrays use minLength/maxLength, not min/max)
    if (schema['minItems'] !== undefined) {
        validator = (validator as ArrV).minLength(schema['minItems']);
    }
    if (schema['maxItems'] !== undefined) {
        validator = (validator as ArrV).maxLength(schema['maxItems']);
    }

    return validator;
}

/**
 * Parse string schema with strict type checking (no coercion)
 */
function parseStringSchema(schema: JsonSchema): Validator {
    // Create a minimal string validator without coercion
    const validator = v.string();

    // Clear existing validators and add strict type check first
    validator.clear();

    // Add strict type check (no coercion)
    validator.push((val: unknown) => {
        if (typeof val !== 'string') {
            throw new Error(`Expected string, got ${typeof val}`);
        }
        return val as string;
    });

    // String constraints
    if (schema['minLength'] !== undefined) {
        validator.push((val: string) => {
            if (val.length < schema['minLength']!) {
                throw new Error(`String length ${val.length} is less than minimum ${schema['minLength']}`);
            }
            return val;
        });
    }
    if (schema['maxLength'] !== undefined) {
        validator.push((val: string) => {
            if (val.length > schema['maxLength']!) {
                throw new Error(`String length ${val.length} exceeds maximum ${schema['maxLength']}`);
            }
            return val;
        });
    }
    if (schema['pattern']) {
        const pattern = new RegExp(schema['pattern']);
        validator.push((val: string) => {
            if (!pattern.test(val)) {
                throw new Error(`String does not match pattern ${schema['pattern']}`);
            }
            return val;
        });
    }

    // String formats (basic support)
    if (schema['format']) {
        switch (schema['format']) {
            case 'email':
                validator.email();
                break;
            case 'uri':
            case 'url':
                validator.url();
                break;
            case 'uuid':
                validator.uuid();
                break;
            case 'date-time':
                validator.isoDatetime();
                break;
            case 'date':
                validator.isoDate();
                break;
            case 'time':
                validator.isoTime();
                break;
        }
    }

    return validator;
}

/**
 * Parse number/integer schema with strict type checking (no coercion)
 */
function parseNumberSchema(schema: JsonSchema): Validator {
    let validator = v.number();

    // Clear existing validators and add strict type check first
    validator.clear();

    // Add strict type check (no coercion)
    validator.push((val: unknown) => {
        if (typeof val !== 'number') {
            throw new Error(`Expected number, got ${typeof val}`);
        }
        return val as number;
    });

    // Integer constraint
    if (schema['type'] === 'integer') {
        validator.push((val: number) => {
            if (!Number.isInteger(val)) {
                throw new Error(`Expected integer, got ${val}`);
            }
            return val;
        });
    }

    // Number constraints
    // Draft 4 style: exclusiveMinimum/Maximum are boolean companions to minimum/maximum
    // Draft 2019-09/2020-12 style: exclusiveMinimum/Maximum are numbers themselves

    if (schema['minimum'] !== undefined) {
        // Check if we have Draft 4 style exclusiveMinimum as boolean
        const hasExclusiveBooleanMin = (schema as unknown as Record<string, unknown>)['exclusiveMinimum'] === true;
        if (hasExclusiveBooleanMin) {
            // Draft 4 style: minimum with exclusiveMinimum: true
            validator = validator.gt(schema['minimum']);
        } else {
            validator = validator.gte(schema['minimum']);
        }
    }

    if (schema['maximum'] !== undefined) {
        // Check if we have Draft 4 style exclusiveMaximum as boolean
        const hasExclusiveBooleanMax = (schema as unknown as Record<string, unknown>)['exclusiveMaximum'] === true;
        if (hasExclusiveBooleanMax) {
            // Draft 4 style: maximum with exclusiveMaximum: true
            validator = validator.lt(schema['maximum']);
        } else {
            validator = validator.lte(schema['maximum']);
        }
    }

    // Draft 2019-09 / 2020-12 style: exclusiveMinimum/Maximum are numbers
    if (typeof schema['exclusiveMinimum'] === 'number') {
        validator = validator.gt(schema['exclusiveMinimum']);
    }
    if (typeof schema['exclusiveMaximum'] === 'number') {
        validator = validator.lt(schema['exclusiveMaximum']);
    }

    if (schema['multipleOf'] !== undefined) {
        validator = validator.multipleOf(schema['multipleOf']);
    }

    return validator;
}

/**
 * Parse enum (creates union of literals)
 */
function parseEnum(values: unknown[]): Validator {
    if (values.length === 0) {
        throw new Error('Empty enum is not supported');
    }

    // Type guard for primitive values
    const isPrimitive = (val: unknown): val is string | number | boolean | null | undefined => {
        return (
            val === null || val === undefined || typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean'
        );
    };

    if (values.length === 1) {
        const val = values[0];
        if (!isPrimitive(val)) {
            throw new Error('Enum values must be primitives');
        }
        return v.literal(val);
    }

    // Create union of literals
    const literals = values.map((val) => {
        if (!isPrimitive(val)) {
            throw new Error('Enum values must be primitives');
        }
        return v.literal(val);
    });

    // values.length is guaranteed >= 2 here (0 and 1 are handled above)
    return v.union([literals[0]!, literals[1]!, ...literals.slice(2)]);
}

/**
 * Parse anyOf (union)
 */
function parseAnyOf(schemas: JsonSchema[], opts: Required<FromJsonSchemaOptions>): Validator {
    if (schemas.length === 0) {
        throw new Error('Empty anyOf is not supported');
    }
    if (schemas.length === 1) {
        const parsed = parseJsonSchema(schemas[0]!, opts);
        return isValidator(parsed) ? parsed : v.object(parsed);
    }

    const validators = schemas.map((s) => {
        const parsed = parseJsonSchema(s, opts);
        return isValidator(parsed) ? parsed : v.object(parsed);
    });

    // schemas.length is guaranteed >= 2 here (0 and 1 are handled above)
    return v.union([validators[0]!, validators[1]!, ...validators.slice(2)]);
}

/**
 * Parse oneOf (exclusive union - maps to anyOf/union in our validator)
 */
function parseOneOf(schemas: JsonSchema[], opts: Required<FromJsonSchemaOptions>): Validator {
    // Note: JSON Schema oneOf is exclusive (exactly one must match)
    // Our validator union is not exclusive (any one can match)
    // For simplicity, treat as union - strict oneOf validation would require custom logic
    return parseAnyOf(schemas, opts);
}

/**
 * Parse allOf (intersection)
 */
function parseAllOf(schemas: JsonSchema[], opts: Required<FromJsonSchemaOptions>): Validator {
    if (schemas.length === 0) {
        return v.object({});
    }
    if (schemas.length === 1) {
        const parsed = parseJsonSchema(schemas[0]!, opts);
        return isValidator(parsed) ? parsed : v.object(parsed);
    }

    // Merge all schemas - works best for object schemas
    const parsed = schemas.map((s) => parseJsonSchema(s, opts));

    // If all are plain schemas (objects), merge them
    const allPlainSchemas = parsed.every((p) => !isValidator(p));
    if (allPlainSchemas) {
        const merged: Record<string, Validator> = {};
        for (const schema of parsed as Record<string, Validator>[]) {
            Object.assign(merged, schema);
        }
        return v.object(merged);
    }

    // If all are validators, try to merge object validators
    const allValidators = parsed.every((p) => isValidator(p));
    if (allValidators) {
        const validators = parsed as Validator[];

        // Try to merge object schemas
        const allObjects = validators.every((val) => {
            return val && typeof val === 'object' && 'schema' in val;
        });

        if (allObjects) {
            const merged: Record<string, Validator> = {};
            for (const validator of validators) {
                // Object validators have a schema property
                const objValidator = validator as unknown as { schema: Record<string, Validator> };
                Object.assign(merged, objValidator.schema);
            }
            return v.object(merged);
        }

        // Intersection is not supported for non-object validators
        throw new Error('allOf with non-object validators is not supported (intersection not available)');
    }

    // Mixed validators and schemas - not supported
    throw new Error('allOf with mixed validator/schema types is not supported');
}

/**
 * Parse multiple types (type: ["string", "number"])
 */
function parseMultipleTypes(types: string[], schema: JsonSchema, opts: Required<FromJsonSchemaOptions>): Validator {
    const validators = types.map((type) => {
        const typeSchema = { ...schema, type };
        return parseJsonSchema(typeSchema as JsonSchema, opts) as Validator;
    });

    if (validators.length === 1) {
        return validators[0]!;
    }

    return v.union(validators as [Validator, Validator, ...Validator[]]);
}

/**
 * Type guard to check if result is a ValueValidator
 */
function isValidator(obj: unknown): obj is Validator {
    return typeof obj === 'object' && obj !== null && 'valueOf' in obj && 'push' in obj;
}
