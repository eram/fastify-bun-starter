# Zody Migration TODO

## Current Status
Zody decorator-based validation framework is ~90% complete. Stage 1 compiler is implemented. Package consolidation complete: validator.ts, schema.ts, and all tests relocated to zody; functional namespace renamed to `zod`; app schemas migrated to decorator-based classes.

## Critical Gap: Field Metadata Population

### The Problem
TypeScript field decorators' `addInitializer` callbacks only execute during instance creation, not at class definition time. This means:
- Fields WITH default values (e.g., `name = 'john'`) → metadata captured ✅
- Fields WITHOUT defaults (e.g., `visits!: bigint`) → metadata NOT captured ❌

### Current Workaround Attempt
Global registry (`decorationRegistry` WeakMap) collects field info from initializer callbacks, Schema decorator processes it. Works for fields with defaults, fails for required fields without defaults.

### Solution Needed
One of these approaches:

1. **Scan source/AST at runtime** - Have Schema decorator extract field information from class structure before instance creation (complex, may require build-time tooling)

2. **Require explicit types for all fields** - Instead of inferring from defaults, require `@z.string`, `@z.number`, etc. for ALL fields:
   ```typescript
   @z.int.min(1) id!: number;        // ✅ Works now
   @z.string.min(3) name = 'john';   // ✅ Works now  
   @z.bigint visits!: bigint;         // ✅ Would work with explicit type
   ```

3. **Hybrid: Infer + explicit** - Infer from defaults when present, fall back to explicit decorators for required fields (current partial implementation)

4. **Deferring metadata building** - Move metadata population to first use (lazy evaluation) instead of class definition time

## Files with TODOs

- `packages/libs/zody/zody.ts` - Lines 52-68 (decorationRegistry, setLastDecoratedClass, registerFieldDecoration, getFieldDecorations)
- `packages/libs/zody/zody.ts` - Lines ~445-460 (makeDecorator addInitializer)
- `packages/libs/zody/zody.ts` - Lines ~720-748 (Schema decorator field collection)

## Tests Blocked
- `packages/libs/zody/zody.test.ts` line 14 - validation fails because `visits` field metadata not populated

## Recommended Next Steps

1. **Verify required fields have explicit type decorators** - Update test class to use `@z.bigint` for required fields
2. **Implement lazy metadata building** - Only populate on first schema access, allowing more time for initializers
3. **Add explicit type requirement** - Document that fields without defaults must have explicit `@z.Type` decorators
4. **Consider deferring to buildArtifacts** - Move registry processing from Schema decorator to buildArtifacts (lazier eval)

## Implementation Checklist

- [x] Extended Op types with all constraints
- [x] Extended createValidator with validation logic
- [x] Extended makeDecorator with all methods  
- [x] Implemented ZodyError
- [x] Implemented .defs() JSON-Schema generation
- [x] Exported functional primitives
- [x] Created package.json, index.ts barrel
- [x] Created parse.ts (parseValidate/safeParseValidate)
- [x] Updated swagger.ts for function-typed schemas
- [x] Removed validator methods from immutable.ts
- [x] Stage 1 compiler — closure-based compilation layer with compile() on all validator types
- [x] Coercion behavior — number/bigint/date primitives now coerce input like validator.ts
- [x] Rewrite hello.ts and health.ts as zody classes
- [x] Delete packages/libs/validator directory (consolidated into zody)
- [x] Functional namespace renamed to `zod`, decorator namespace remains `z`
- [ ] Fix metadata population for required fields
- [ ] Port all validator tests to zody
- [ ] Full integration testing
