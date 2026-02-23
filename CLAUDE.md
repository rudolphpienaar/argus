# ARGUS — Claude Code Instructions

## TypeScript Style Rules

### Explicit Type Annotations (MANDATORY)

Every `const` and `let` declaration MUST carry an explicit `: Type` annotation,
even when the type is trivially inferrable from the right-hand side.

**Correct:**
```typescript
const index: Map<string, DAGNode> = new Map<string, DAGNode>();
const declared: Set<string> = new Set<string>();
const nodes: DAGNode[] = definition.orderedNodeIds.map(...);
const result: TransitionResult | null = null;
```

**Wrong (do not write):**
```typescript
const index = new Map<string, DAGNode>();
const declared = new Set<string>();
const nodes = definition.orderedNodeIds.map(...);
const result = null;
```

This applies to:
- All local variable declarations inside functions and methods
- All destructured bindings where the type can be stated
- Loop variables where the element type is known

### Docstrings (MANDATORY)

Every function, method, and class — public or private — must have a JSDoc block with:
- A description line
- `@param name - description` for every parameter
- `@returns description` for every non-void return
- `@throws description` where applicable

Interfaces must have a class-level JSDoc. All fields on exported interfaces must
have an inline `/** description */` comment.

### No `any`

`any` is forbidden. Use specific types, typed interfaces, or `unknown` with a
narrowing guard.
