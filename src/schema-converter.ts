import { z, type ZodTypeAny } from "zod";

// fastest-validator schema definitions are inherently untyped
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ValidatorDef = Record<string, any>;

// Patterns of the fastest-validator string flags. They are exported to the JSON Schema
// as `pattern`, so the LLM knows the expected format.
// RegExp flags (e.g. `/i`) are lost in the JSON Schema: write case-insensitive patterns explicitly.
const STRING_FLAG_PATTERNS: Record<string, RegExp> = {
	alpha: /^[a-zA-Z]+$/,
	numeric: /^-?[0-9]\d*(\.\d+)?$/,
	alphanum: /^[a-zA-Z0-9]+$/,
	alphadash: /^[a-zA-Z0-9_-]+$/,
	hex: /^[0-9a-fA-F]+$/,
	base64: /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
	singleLine: /^[^\r\n]*$/
};

const MAC_PATTERN =
	/^((([a-fA-F0-9][a-fA-F0-9]+[-]){5}|([a-fA-F0-9][a-fA-F0-9]+[:]){5})([a-fA-F0-9][a-fA-F0-9])$)|(^([a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9]+[.]){2}([a-fA-F0-9][a-fA-F0-9][a-fA-F0-9][a-fA-F0-9]))$/;

// From fastest-validator (lib/rules/currency.js)
const CURRENCY_REGEX = "(?=.*\\d)^(-?~1|~1-?)(([0-9]\\d{0,2}(~2\\d{3})*)|0)?(\\~3\\d{1,2})?$";

function convertSingleField(def: ValidatorDef): ZodTypeAny {
	const type = def.type;
	let schema: ZodTypeAny;

	switch (type) {
		case "string":
			schema = buildString(def);
			break;
		case "number":
			schema = buildNumber(def);
			break;
		case "boolean":
			schema = z.boolean();
			break;
		case "array":
			schema = buildArray(def);
			break;
		case "object":
			schema = buildObject(def);
			break;
		case "enum":
			schema = buildEnum(def);
			break;
		case "date":
			schema = z.string();
			break;
		case "email":
			schema = z.string().email();
			break;
		case "url":
			schema = z.string().url();
			break;
		case "uuid":
			schema = z.string().uuid();
			break;
		case "multi":
			schema = buildMulti(def.rules);
			break;
		case "mac":
			schema = z.string().regex(MAC_PATTERN);
			break;
		case "currency":
			schema = buildCurrency(def);
			break;
		case "luhn":
			// The checksum can't be expressed in JSON Schema, describe it instead
			schema = z
				.string()
				.describe("Number validated with the Luhn checksum (e.g. a credit card number)");
			break;
		case "tuple":
			schema = buildTuple(def);
			break;
		case "record":
			schema = buildRecord(def);
			break;
		case "equal":
			schema = buildEqual(def);
			break;
		case "any":
			schema = z.any();
			break;
		default:
			schema = z.any();
			break;
	}

	// The description is the only hint the LLM gets about the meaning of a field
	if (typeof def.description === "string") {
		schema = schema.describe(def.description);
	}
	if (def.nullable === true) {
		schema = schema.nullable();
	}
	if (typeof def.default === "function") {
		// A dynamic default (e.g. `() => Date.now()`) is applied by the action itself
		schema = schema.optional();
	} else if (def.default !== undefined) {
		schema = schema.default(def.default);
	}
	if (def.optional === true) {
		schema = schema.optional();
	}

	return schema;
}

function buildString(def: ValidatorDef): ZodTypeAny {
	let s = z.string();
	if (def.empty === false) s = s.min(1);
	if (def.length != null) s = s.length(def.length);
	if (def.min != null) s = s.min(def.min);
	if (def.max != null) s = s.max(def.max);
	if (def.pattern) s = s.regex(new RegExp(def.pattern, def.patternFlags));
	for (const [flag, pattern] of Object.entries(STRING_FLAG_PATTERNS)) {
		if (def[flag] === true) s = s.regex(pattern);
	}
	if (def.enum != null && Array.isArray(def.enum) && def.enum.length > 0) {
		const allStrings = def.enum.every((v: unknown) => typeof v === "string");
		if (allStrings) return z.enum(def.enum as [string, ...string[]]);
		const literals = def.enum.map((v: string | number | boolean) => z.literal(v));
		return z.union(literals as unknown as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
	}
	if (def.email === true) return z.string().email();
	if (def.url === true) return z.string().url();
	return s;
}

function buildNumber(def: ValidatorDef): ZodTypeAny {
	let n = z.number();
	if (def.min != null) n = n.min(def.min);
	if (def.max != null) n = n.max(def.max);
	if (def.positive === true) n = n.positive();
	if (def.negative === true) n = n.negative();
	if (def.integer === true) n = n.int();
	return n;
}

function buildArray(def: ValidatorDef): ZodTypeAny {
	const itemSchema = def.items ? parseFieldDef(def.items) : z.any();
	let a = z.array(itemSchema);
	if (def.empty === false) a = a.min(1);
	if (def.length != null) a = a.length(def.length);
	if (def.min != null) a = a.min(def.min);
	if (def.max != null) a = a.max(def.max);
	return a;
}

function buildObject(def: ValidatorDef): ZodTypeAny {
	// fastest-validator accepts both `props` and `properties`
	const props = def.props ?? def.properties;
	const shape: Record<string, ZodTypeAny> = {};
	for (const [key, val] of Object.entries(props ?? {})) {
		shape[key] = parseFieldDef(val);
	}
	const object = z.object(shape);
	// Like fastest-validator, unknown properties are kept unless `strict` is set: the Zod
	// default would strip them, and an object without `props` would always arrive empty
	if (def.strict === true) return object.strict();
	if (def.strict === "remove") return object;
	return object.passthrough();
}

/**
 * The fastest-validator shorthand of nested objects: `{ $$type: "object|optional", city: "string" }`
 */
function convertShorthandObject(def: ValidatorDef): ZodTypeAny {
	const { $$type, ...props } = def;
	return convertSingleField({ ...parsePipeSyntax($$type), type: "object", props });
}

function buildEnum(def: ValidatorDef): ZodTypeAny {
	if (Array.isArray(def.values) && def.values.length > 0) {
		const allStrings = def.values.every((v: unknown) => typeof v === "string");
		if (allStrings) return z.enum(def.values as [string, ...string[]]);
		const literals = def.values.map((v: string | number | boolean) => z.literal(v));
		return z.union(literals as unknown as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
	}
	return z.any();
}

function buildCurrency(def: ValidatorDef): ZodTypeAny {
	if (def.customRegex) return z.string().regex(new RegExp(def.customRegex));

	const currencySymbol = def.currencySymbol || null;
	const thousandSeparator = def.thousandSeparator || ",";
	const decimalSeparator = def.decimalSeparator || ".";
	const isCurrencySymbolMandatory = !def.symbolOptional;
	const pattern = CURRENCY_REGEX.replace(
		/~1/g,
		currencySymbol ? `\\${currencySymbol}${isCurrencySymbolMandatory ? "" : "?"}` : ""
	)
		.replace("~2", thousandSeparator)
		.replace("~3", decimalSeparator);

	return z.string().regex(new RegExp(pattern));
}

function buildTuple(def: ValidatorDef): ZodTypeAny {
	if (!Array.isArray(def.items) || def.items.length === 0) return z.array(z.any());
	const items = def.items.map((item: unknown) => parseFieldDef(item));
	return z.tuple(items as [ZodTypeAny, ...ZodTypeAny[]]);
}

function buildRecord(def: ValidatorDef): ZodTypeAny {
	// JSON object keys are always strings, but they can still be restricted (e.g. enum, pattern)
	const key = def.key ? parseFieldDef(def.key) : z.string();
	const value = def.value ? parseFieldDef(def.value) : z.any();
	return z.record(key, value);
}

function buildEqual(def: ValidatorDef): ZodTypeAny {
	// Equality with another field (`field`) can't be expressed in JSON Schema
	if (def.field) return z.any();
	const value = def.value;
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean" ||
		value === null
	) {
		return z.literal(value);
	}
	return z.any();
}

function buildMulti(rules: unknown): ZodTypeAny {
	if (!Array.isArray(rules) || rules.length === 0) return z.any();
	if (rules.length === 1) return parseFieldDef(rules[0]);
	const schemas = rules.map(rule => parseFieldDef(rule));
	return z.union(schemas as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
}

function parsePipeValue(value: string): unknown {
	if (value === "true") return true;
	if (value === "false") return false;
	const num = Number(value);
	return value !== "" && !isNaN(num) ? num : value;
}

function parsePipeSyntax(pipe: string): ValidatorDef {
	const parts = pipe.split("|");
	const type = parts[0];
	const def: ValidatorDef = { type };
	for (let i = 1; i < parts.length; i++) {
		const part = parts[i];

		// `key:value` options, e.g. "string|min:3|max:10"
		const sep = part.indexOf(":");
		if (sep > 0) {
			def[part.slice(0, sep)] = parsePipeValue(part.slice(sep + 1));
			continue;
		}

		switch (part) {
			case "integer":
				def.integer = true;
				break;
			case "positive":
				def.positive = true;
				break;
			case "negative":
				def.negative = true;
				break;
			case "optional":
				def.optional = true;
				break;
			case "email":
				if (type === "string") def.email = true;
				else def.type = "email";
				break;
			case "url":
				if (type === "string") def.url = true;
				else def.type = "url";
				break;
			default:
				// Any other flag, e.g. "nullable", "empty:false" is handled above
				def[part] = true;
				break;
		}
	}
	return def;
}

function parseFieldDef(field: unknown): ZodTypeAny {
	if (typeof field === "string") {
		if (field.includes("|")) {
			return convertSingleField(parsePipeSyntax(field));
		}
		return convertSingleField({ type: field });
	}
	// An array of rules is the fastest-validator shorthand for a "multi" rule
	if (Array.isArray(field)) {
		return buildMulti(field);
	}
	if (typeof field === "object" && field !== null) {
		const def = field as ValidatorDef;
		if (typeof def.$$type === "string") return convertShorthandObject(def);
		// e.g. `{ $$root: true, type: "string|min:3" }`
		if (typeof def.type === "string" && def.type.includes("|")) {
			return convertSingleField({ ...def, ...parsePipeSyntax(def.type) });
		}
		return convertSingleField(def);
	}
	return z.any();
}

export function convertFastestValidatorToZod(schema: ValidatorDef): Record<string, ZodTypeAny> {
	if (schema.$$root === true) {
		const rootDef = { ...schema };
		delete rootDef.$$root;
		return { $$root: parseFieldDef(rootDef) };
	}

	const result: Record<string, ZodTypeAny> = {};
	for (const [key, val] of Object.entries(schema)) {
		if (key.startsWith("$$")) continue;
		result[key] = parseFieldDef(val);
	}
	return result;
}

export function convertActionParamsToZod(params: unknown): Record<string, ZodTypeAny> {
	if (params == null) return {};
	if (typeof params === "string") {
		return convertFastestValidatorToZod({ $$root: true, type: params });
	}
	if (typeof params === "object") {
		return convertFastestValidatorToZod(params as ValidatorDef);
	}
	return {};
}
