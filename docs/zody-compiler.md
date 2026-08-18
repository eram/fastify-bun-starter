the plan is to turn `zody` from an **interpreter-style validator system** into a **compiler-backed validator system** while keeping the same public authoring model. Right now validators are schema objects that execute rule-by-rule on every call, and the new design makes each validator able to compile itself once into a faster execution path, then lets parent validators chain those compiled children into a compiled whole-object validator.[^1]

## Goal

The main idea is:

- decorators collect metadata
- schema build normalizes and seals metadata
- validators are materialized as validator nodes
- each validator node has `compile()`
- parent nodes compile children and assemble them
- class `validate()` uses the compiled path, not `safeParse(...).success`.[^1]

So this is not “convert to Zod internals faster”; it is “build your own validator IR and compile from it.”

## Current state

Today, `buildArtifacts()` creates a schema from normalized field metadata and then calls `makeCompiledValidate(schema)`, but that function currently just returns a closure around `schema.safeParse(input).success`. That means the system caches the schema object, but the hot validation path still interprets the schema tree on every call.[^1]

So the architecture gap is:

- you already have metadata collection
- you already have normalization
- you already have validator objects
- you **do not yet have compiled validator nodes**.[^1]


## Target architecture

The target design is a two-layer runtime.

### Layer 1: validator nodes

Every validator object becomes a node with:

- `parse(input)`
- `safeParse(input)`
- `compile()`

`compile()` returns a compiled executable form, for example:

- `validate(input): boolean`
- optionally `parse(input): T`
- maybe internal metadata like `kind`, `usesDefault`, `isOptional`

This applies to:

- primitive validators from `createValidator(...)`
- `arrayValidator(...)`
- `objectValidator(...)`
- future `unionValidator(...)`


### Layer 2: schema-level compilation

The class schema build phase calls `compile()` on the root object validator, which recursively compiles its children and produces the final cached fast validator. After that, `Class.validate(input)` routes to the compiled function instead of the interpreted one.[^1]

## What changes conceptually

Right now each validation call walks the same rule description again and again. The new design moves that work into a one-time compilation phase.

Instead of:

- object validator iterates fields
- field validator runs parse logic
- each parse checks options dynamically

you want:

- object validator compiles each field once
- field validator resolves its options once
- final validate path is a direct composition of specialized checks

So compilation means:

- resolve conflicts
- derive effective type/rules
- pre-build fast execution closures or generated functions
- freeze the schema shape


## Execution strategy

Do this in two stages.

### Stage 1: closure compilation

The first implementation should compile validators into specialized closures, not source strings. This is easier, safer, and already gives most of the structural performance win.

Example:

- a number validator with `int + gte(1)` compiles to one closure containing those exact checks
- an object validator compiles all field closures and stores them in an array of `[key, compiled]`
- validate just loops those precompiled entries

This removes most repeated branching and method dispatch.

### Stage 2: source generation

Once the compile graph is stable, hot validators can emit flat JS source and use `new Function(...)` for maximal speed. That is where you get the “rewrite to flat code” effect you originally wanted.

Example outcome:

- object schema with fixed keys emits a hardcoded property-check function
- unions emit inline OR chains
- arrays emit loops calling compiled child functions

But the important thing is: source generation is a backend for the compile layer, not the first step.

## Compile responsibilities per validator

### Primitive validators

Each primitive validator created by `createValidator(...)` should compile from its already-known options:

- root type
- optional/default
- numeric constraints
- string length constraints
- format checks
- transforms if any

Its `compile()` method should resolve all those once and return a specialized validator closure.

This is the lowest-level unit of compilation.

### Array validators

Array validators should compile their element validator once, then build a parent compiled closure that:

- checks `Array.isArray(input)`
- loops items
- calls compiled child validator on each item

So the array compiler **chains** the child compiler.

### Union validators

Union validators should compile every option once, then build a parent closure that:

- tries each compiled option in order
- succeeds on first match
- fails if none match

So union compilation is “fan-out then aggregate”.

### Object validators

Object validators are the root case and the most important one. They should compile each field validator once, then create a parent closure that:

- checks object-ness
- rejects `null` and arrays
- validates each property through the compiled field validator
- optionally builds parsed output with defaults

This is where the whole schema becomes a compiled whole-object validator.

## Build lifecycle

The lifecycle should be:

1. decorators record field ops under `__z_meta__`
2. first schema access gathers inherited and local metadata
3. normalize metadata and detect contradictions
4. build validator nodes
5. compile root validator
6. cache `{ schema, compiled }`
7. all later `validate()` calls use the cached compiled function.[^1]

This means “compile on first schema use” is the safest default because your current metadata gathering via field initializers may not be complete at class-definition time.[^1]

## Eager normalization vs eager compilation

These are separate and both matter.

### Eager normalization

Always do this before compilation:

- merge inherited metadata
- resolve explicit vs inferred root type
- apply default inference
- mark optional/default semantics
- throw on contradictions

This should happen exactly once per class schema build.[^1]

### Eager compilation

Once normalization succeeds, compile the root validator immediately and cache it. That means the first `validate()` call pays the compile cost, but every later call is hot-path only.

So the recommendation is:

- normalize eagerly when building artifacts
- compile eagerly as part of artifact build
- trigger artifact build lazily on first schema use


## Error policy

Conflicts should throw during normalization, before compilation. That includes:

- multiple incompatible explicit roots
- explicit root contradicting inferred root
- impossible constraint combinations
- invalid default value for the resolved type

This keeps compile code simple because it only sees valid normalized schema nodes.

## Public API impact

Public authoring stays mostly the same:

- decorators remain Zod-like
- `@z.Schema()` stays the class decorator
- `Class.validate()` becomes backed by compiled code
- `Class.parse()` / `safeParse()` can still use interpreted or compiled parse paths
- `Class.toZod()` can still materialize a compatibility schema if needed

So the new compile system is mostly an internal execution-engine replacement, not a user-facing API rewrite.

## Compatibility with `toZod()`

Keep `toZod()` separate from the compiled validator path. The compiled path is your fast runtime engine. `toZod()` is a compatibility adapter for type inference and integrations.

Both should be derived from the same normalized schema model, but they serve different consumers:

- compiled validator for speed
- Zod-like schema for ecosystem compatibility

So do **not** make compilation depend on Zod materialization. They should be sibling backends from the same normalized metadata.

## Recommended implementation order

Implement in this order:

1. Add `compile()` to primitive validators.
2. Add `compile()` to array validators.
3. Add `compile()` to object validators.
4. Replace `makeCompiledValidate(schema)` so it uses `schema.compile()`.
5. Cache the compiled root in `buildArtifacts()`.
6. Add union compilation.
7. Only after that, consider `new Function(...)` source generation for hot object/primitive cases.

That sequence minimizes breakage and gives you checkpoints.

## One-sentence summary

What you are doing is: **turning `zody` into a metadata-driven schema compiler where each validator node can compile itself, parent validators compose compiled children, and class validation uses a cached compiled root instead of interpreting schema rules on every call**.[^1]

