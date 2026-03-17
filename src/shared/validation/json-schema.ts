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
 * Remove provider-hostile schema meta fields without changing schema meaning.
 */
export function sanitizeJsonSchemaForProvider<T>(schema: T): T {
  return sanitizeJsonSchemaValue(schema) as T;
}

export interface JsonSchemaValidationResult {
  valid: boolean;
  errors: string[];
}

function formatPath(path: string): string {
  return path || '(root)';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validatePrimitiveType(
  expectedType: string,
  value: unknown,
): boolean {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isPlainObject(value);
    default:
      return true;
  }
}

function validateAgainstSchema(
  schema: unknown,
  value: unknown,
  path: string,
  errors: string[],
): void {
  if (errors.length >= 25) {
    return;
  }

  if (schema === true || schema === undefined || schema === null) {
    return;
  }

  if (schema === false) {
    errors.push(`${formatPath(path)} is not allowed by schema.`);
    return;
  }

  if (!isPlainObject(schema)) {
    return;
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => Object.is(entry, value))) {
    errors.push(`${formatPath(path)} must match one of the allowed enum values.`);
    return;
  }

  if ('const' in schema && !Object.is(schema.const, value)) {
    errors.push(`${formatPath(path)} must match the required constant value.`);
    return;
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const matched = schema.anyOf.some((candidate) => validateJsonSchema(candidate, value).valid);
    if (!matched) {
      errors.push(`${formatPath(path)} did not match any allowed schema variant.`);
    }
    return;
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const matches = schema.oneOf.filter((candidate) => validateJsonSchema(candidate, value).valid).length;
    if (matches !== 1) {
      errors.push(`${formatPath(path)} must match exactly one allowed schema variant.`);
    }
    return;
  }

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    for (const candidate of schema.allOf) {
      validateAgainstSchema(candidate, value, path, errors);
      if (errors.length >= 25) return;
    }
  }

  const rawTypes = Array.isArray(schema.type) ? schema.type : typeof schema.type === 'string' ? [schema.type] : [];
  if (rawTypes.length > 0) {
    const validType = rawTypes.some((expectedType) => validatePrimitiveType(expectedType, value));
    if (!validType) {
      errors.push(`${formatPath(path)} must be ${rawTypes.join(' or ')}.`);
      return;
    }
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${formatPath(path)} must be at least ${schema.minLength} characters.`);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(`${formatPath(path)} must be at most ${schema.maxLength} characters.`);
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${formatPath(path)} must be greater than or equal to ${schema.minimum}.`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${formatPath(path)} must be less than or equal to ${schema.maximum}.`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${formatPath(path)} must contain at least ${schema.minItems} items.`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${formatPath(path)} must contain at most ${schema.maxItems} items.`);
    }
    if (schema.items !== undefined) {
      value.forEach((entry, index) => {
        validateAgainstSchema(schema.items, entry, `${path}[${index}]`, errors);
      });
    }
    return;
  }

  if (!isPlainObject(value)) {
    return;
  }

  const properties = isPlainObject(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((entry): entry is string => typeof entry === 'string')
    : [];

  for (const key of required) {
    if (!(key in value)) {
      errors.push(`${formatPath(path ? `${path}.${key}` : key)} is required.`);
    }
  }

  for (const [key, childValue] of Object.entries(value)) {
    if (key in properties) {
      validateAgainstSchema(properties[key], childValue, path ? `${path}.${key}` : key, errors);
      continue;
    }

    if (schema.additionalProperties === false) {
      errors.push(`${formatPath(path ? `${path}.${key}` : key)} is not allowed.`);
      continue;
    }

    if (schema.additionalProperties !== undefined && schema.additionalProperties !== true) {
      validateAgainstSchema(
        schema.additionalProperties,
        childValue,
        path ? `${path}.${key}` : key,
        errors,
      );
    }
  }
}

export function validateJsonSchema(schema: unknown, value: unknown): JsonSchemaValidationResult {
  const errors: string[] = [];
  validateAgainstSchema(sanitizeJsonSchemaForProvider(schema), value, '', errors);
  return {
    valid: errors.length === 0,
    errors,
  };
}
