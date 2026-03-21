import { z, type ZodType } from 'zod';

type JsonSchema = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function unsupported(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

function applyCommonStringRules(schema: JsonSchema, out: z.ZodString): z.ZodTypeAny {
  let current: z.ZodTypeAny = out;
  if (typeof schema.minLength === 'number') current = (current as z.ZodString).min(schema.minLength);
  if (typeof schema.maxLength === 'number') current = (current as z.ZodString).max(schema.maxLength);
  if (typeof schema.pattern === 'string') current = (current as z.ZodString).regex(new RegExp(schema.pattern));
  if (schema.format === 'uri' || schema.format === 'url') current = (current as z.ZodString).url();
  if (schema.format === 'uuid') current = (current as z.ZodString).uuid();
  if (schema.format === 'email') current = (current as z.ZodString).email();
  return current;
}

function applyCommonNumberRules(schema: JsonSchema, out: z.ZodNumber): z.ZodTypeAny {
  let current: z.ZodTypeAny = out;
  if (typeof schema.minimum === 'number') current = (current as z.ZodNumber).min(schema.minimum);
  if (typeof schema.maximum === 'number') current = (current as z.ZodNumber).max(schema.maximum);
  if (typeof schema.exclusiveMinimum === 'number') current = (current as z.ZodNumber).gt(schema.exclusiveMinimum);
  if (typeof schema.exclusiveMaximum === 'number') current = (current as z.ZodNumber).lt(schema.exclusiveMaximum);
  return current;
}

function convertArraySchema(schema: JsonSchema, path: string): ZodType {
  const items = schema.items;
  if (!isRecord(items)) {
    unsupported(path, 'array schemas must declare an object "items" schema');
  }
  let out = z.array(convertSchema(items, `${path}.items`));
  if (typeof schema.minItems === 'number') out = out.min(schema.minItems);
  if (typeof schema.maxItems === 'number') out = out.max(schema.maxItems);
  return out;
}

function convertObjectSchema(schema: JsonSchema, path: string): ZodType {
  const propertiesValue = schema.properties;
  const properties = isRecord(propertiesValue) ? propertiesValue : {};
  const required = Array.isArray(schema.required)
    ? new Set(schema.required.filter((entry): entry is string => typeof entry === 'string'))
    : new Set<string>();

  const shape: Record<string, ZodType> = {};
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!isRecord(propertySchema)) {
      unsupported(`${path}.properties.${key}`, 'property schemas must be objects');
    }
    const converted = convertSchema(propertySchema, `${path}.properties.${key}`);
    shape[key] = required.has(key) ? converted : converted.optional();
  }

  let out = z.object(shape);
  if (schema.additionalProperties === false) {
    out = out.strict();
  }
  return out;
}

function convertEnumSchema(schema: JsonSchema, path: string): ZodType {
  const values = schema.enum;
  if (!Array.isArray(values) || values.length === 0) {
    unsupported(path, 'enum must be a non-empty array');
  }
  const normalized = values.filter(
    (entry): entry is string | number | boolean | null =>
      typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean' || entry === null,
  );
  if (normalized.length !== values.length) {
    unsupported(path, 'enum contains unsupported values');
  }
  if (normalized.every((entry) => typeof entry === 'string')) {
    return z.enum(normalized as [string, ...string[]]);
  }
  if (normalized.length === 1) {
    return z.literal(normalized[0]);
  }
  return z.union(
    normalized.map((entry) => z.literal(entry)) as unknown as [ZodType, ZodType, ...ZodType[]],
  );
}

function convertTypeSchema(schema: JsonSchema, path: string): ZodType {
  const rawType = schema.type;
  const types = Array.isArray(rawType) ? rawType : [rawType];
  const nullable = types.includes('null');
  const nonNullTypes = types.filter((entry) => entry !== 'null');
  if (nonNullTypes.length !== 1 || typeof nonNullTypes[0] !== 'string') {
    unsupported(path, 'only a single non-null JSON Schema type is supported');
  }

  let out: ZodType;
  switch (nonNullTypes[0]) {
    case 'string':
      out = applyCommonStringRules(schema, z.string());
      break;
    case 'number':
      out = applyCommonNumberRules(schema, z.number());
      break;
    case 'integer':
      out = applyCommonNumberRules(schema, z.number().int());
      break;
    case 'boolean':
      out = z.boolean();
      break;
    case 'array':
      out = convertArraySchema(schema, path);
      break;
    case 'object':
      out = convertObjectSchema(schema, path);
      break;
    default:
      unsupported(path, `unsupported type "${nonNullTypes[0]}"`);
  }

  return nullable ? out.nullable() : out;
}

function convertSchema(schema: JsonSchema, path: string): ZodType {
  for (const key of ['oneOf', 'anyOf', 'allOf', 'not', '$ref', 'patternProperties', 'dependencies']) {
    if (key in schema) {
      unsupported(path, `unsupported schema keyword "${key}"`);
    }
  }

  if ('const' in schema) {
    return z.literal(schema.const as never);
  }
  if ('enum' in schema) {
    return convertEnumSchema(schema, path);
  }
  return convertTypeSchema(schema, path);
}

export function convertJsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  if (!isRecord(schema)) {
    unsupported('inputSchema', 'schema must be an object');
  }
  const converted = convertSchema(schema, 'inputSchema');
  if (!(converted instanceof z.ZodObject)) {
    unsupported('inputSchema', 'top-level schema must convert to a Zod object');
  }
  return converted;
}
