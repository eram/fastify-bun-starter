> **Superseded.** This document originally proposed a two-stage design: Stage 1
> closure-compiled `compile()` on every validator node, then an optional Stage 2
> `new Function(...)` source-generation layer bolted on top of it, implemented
> separately (and duplicated) in both `zody.ts` (decorators) and `validator.ts`
> (functional API). That plan shipped, but `codegen()` never actually stood on
> its own — its default implementation just bound the Stage-1 compiled predicate
> as a closure, so the "source generation" layer wasn't self-sufficient. The
> sections below describe what actually shipped in its place. Kept for history.

## What's implemented

`zody` has a single validator implementation, in `validator.ts` — the `TypeV`
hierarchy (`StrV`, `NumV`, `ObjV`, `ArrV`, `UnionV`, ...) used by both:

- the functional/"zod" API (`string()`, `number()`, `object()`, ...)
- the decorator API (`zody.ts`'s `@z.string`, `@z.Schema()`), which has **no**
  validation logic of its own — `toZodNode()`/`applyOps()` just translate
  decorator metadata into calls onto these same `TypeV` nodes.

There is no `compile()` / `CompiledNode` anymore. Every validator node
implements `codegen(ctx, expr)` (in `codegen.ts` + `validator.ts`), returning a
boolean JS expression that tests `expr`. Container nodes (`ObjV`/`ArrV`/`UnionV`/
`NullableV`/`NullishV`) compose their children's expressions bottom-up. Shared
fragment builders (`comparison`, `lengthCheck`, `regexTest`, `arrayOfCheck`,
`objectShapeCheck`, ...) live in `codegen.ts` so the two APIs never reimplement
the same structural check twice.

**Self-replacement happens only at the schema root** — the `ObjV` instance
returned by `object()`/`strictObject()`/`looseObject()` (and, transitively, the
instance cached per decorated class). Its `validate(input)` override:

```ts
override validate(input: unknown): boolean {
    if (!isCodeGenEnabled()) return super.validate(input);
    const fast = buildToFunction(this);
    Object.defineProperty(this, 'validate', { value: fast, writable: true, configurable: true });
    return fast(input);
}
```

First call materializes one `new Function(...)` from `this.codegen()` (which
recurses through every field's own `codegen()`) and replaces `validate` on that
instance. Every later call goes straight to the compiled function. Nested
validators never do this themselves — they only ever expose `codegen()` for the
root to compose.

`zody.ts`'s decorator `Schema.validate()` is a thin forward to the cached root
`ObjV`'s own `validate()` — because the schema instance is cached per class
(`buildArtifacts()`'s existing `CACHE` symbol), that instance's self-replacement
persists across every later call automatically. `autocompile` warms this ahead
of time (in `setImmediate`, on class decoration) by calling `.validate()` once
on a throwaway input and discarding the result.

A global toggle governs whether this ever happens at all:

```ts
enableCodeGen(false); // validate() always falls back to interpreted safeParse().success
enableCodeGen(true);  // default — validate() self-replaces on first call
```

Useful under a CSP that disallows `new Function`, or for debugging.

## Error policy (unchanged)

Conflicts still throw during metadata normalization, before any validator node
is built: multiple incompatible explicit roots, explicit root contradicting an
inferred one, missing union options, etc.

## Compatibility with `toZod()` (unchanged)

`toZod()` still returns the same underlying `ObjV` used for validation — it was
never a separate materialization path, just the compatibility name for "the
schema."
