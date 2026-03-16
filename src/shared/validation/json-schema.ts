function sanitizeJsonSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeJsonSchemaValue);
  }

  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(input)) {
      if (key === '$schema') {
        continue;
      }
      output[key] = sanitizeJsonSchemaValue(nestedValue);
    }

    return output;
  }

  return value;
}

/**
 * Remove schema-meta fields that some OpenAI-compatible providers reject.
 */
export function sanitizeJsonSchemaForProvider<T>(schema: T): T {
  return sanitizeJsonSchemaValue(schema) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (isRecord(value)) {
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function cloneSchema<T>(value: T): T {
  return sanitizeJsonSchemaForProvider(value);
}

function mergeSchemaList(schemas: Record<string, unknown>[]): Record<string, unknown> {
  const unique = new Map<string, Record<string, unknown>>();
  for (const schema of schemas) {
    unique.set(stableStringify(schema), cloneSchema(schema));
  }
  const deduped = Array.from(unique.values());
  if (deduped.length === 1) {
    return deduped[0];
  }

  const constValues = deduped
    .map((schema) => schema.const)
    .filter((value) => value !== undefined);
  if (constValues.length === deduped.length) {
    const valueType = typeof constValues[0];
    if (constValues.every((value) => typeof value === valueType)) {
      const base = { ...deduped[0] };
      delete base.const;
      base.enum = Array.from(new Set(constValues));
      if (!base.type && valueType !== 'undefined') {
        base.type = valueType;
      }
      return base;
    }
  }

  const flattenedAnyOf = deduped.flatMap((schema) => {
    const anyOf = schema.anyOf;
    if (Array.isArray(anyOf)) {
      return anyOf.filter(isRecord).map((entry) => cloneSchema(entry));
    }
    return [cloneSchema(schema)];
  });

  const flattenedUnique = new Map<string, Record<string, unknown>>();
  for (const schema of flattenedAnyOf) {
    flattenedUnique.set(stableStringify(schema), schema);
  }

  return {
    anyOf: Array.from(flattenedUnique.values()),
  };
}

function normalizeTopLevelUnionSchema(schema: Record<string, unknown>): Record<string, unknown> | null {
  const variants =
    (Array.isArray(schema.oneOf) ? schema.oneOf : null) ??
    (Array.isArray(schema.anyOf) ? schema.anyOf : null);
  if (!variants || variants.length === 0) {
    return null;
  }

  const objectVariants = variants.filter(isRecord);
  if (objectVariants.length !== variants.length) {
    return null;
  }

  const mergedProperties = new Map<string, Record<string, unknown>[]>();
  const requiredSets: string[][] = [];
  const actionConsts: string[] = [];
  let allDisallowAdditionalProps = true;

  for (const variant of objectVariants) {
    if (variant.type !== 'object') {
      return null;
    }
    const properties = variant.properties;
    if (!isRecord(properties)) {
      return null;
    }

    const required = Array.isArray(variant.required)
      ? variant.required.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    requiredSets.push(required);

    if (variant.additionalProperties !== false) {
      allDisallowAdditionalProps = false;
    }

    const actionSchema = properties.action;
    if (!isRecord(actionSchema) || typeof actionSchema.const !== 'string' || actionSchema.const.trim().length === 0) {
      return null;
    }
    actionConsts.push(actionSchema.const);

    for (const [propertyName, propertySchema] of Object.entries(properties)) {
      if (!isRecord(propertySchema)) {
        return null;
      }
      const existing = mergedProperties.get(propertyName) ?? [];
      existing.push(propertySchema);
      mergedProperties.set(propertyName, existing);
    }
  }

  const compiledProperties: Record<string, unknown> = {};
  for (const [propertyName, propertySchemas] of mergedProperties.entries()) {
    if (propertyName === 'action') {
      const first = cloneSchema(propertySchemas[0]);
      delete first.const;
      first.type = typeof first.type === 'string' ? first.type : 'string';
      first.enum = Array.from(new Set(actionConsts));
      compiledProperties[propertyName] = first;
      continue;
    }

    compiledProperties[propertyName] = mergeSchemaList(propertySchemas);
  }

  const requiredIntersection =
    requiredSets.length > 0
      ? requiredSets.reduce<string[]>(
        (acc, current) => acc.filter((value) => current.includes(value)),
        [...requiredSets[0]],
      )
      : [];

  const normalized: Record<string, unknown> = {
    type: 'object',
    properties: compiledProperties,
  };
  if (requiredIntersection.length > 0) {
    normalized.required = requiredIntersection;
  }
  if (allDisallowAdditionalProps) {
    normalized.additionalProperties = false;
  }

  for (const key of ['title', 'description']) {
    if (typeof schema[key] === 'string' && String(schema[key]).trim().length > 0) {
      normalized[key] = schema[key];
    }
  }

  return normalized;
}

/**
 * Compile provider-facing tool parameters into a canonical Chat Completions
 * top-level object schema. This preserves routed discriminated-union tools by
 * flattening their top-level oneOf/anyOf into a single object schema with an
 * enum-backed discriminator property.
 */
export function normalizeToolParametersForChatCompletions(
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized = sanitizeJsonSchemaForProvider(parameters);
  if (!isRecord(sanitized)) {
    return parameters;
  }

  const unionNormalized = normalizeTopLevelUnionSchema(sanitized);
  return unionNormalized ?? sanitized;
}
