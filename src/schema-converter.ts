import { z, ZodTypeAny } from "zod";

function convertSingleField(def: Record<string, any>): ZodTypeAny {
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
		case "any":
			schema = z.any();
			break;
		default:
			schema = z.any();
			break;
	}

	if (def.default !== undefined) {
		schema = schema.default(def.default);
	}
	if (def.optional === true) {
		schema = schema.optional();
	}

	return schema;
}

function buildString(def: Record<string, any>): ZodTypeAny {
	let s = z.string();
	if (def.min != null) s = s.min(def.min);
	if (def.max != null) s = s.max(def.max);
	if (def.pattern) s = s.regex(new RegExp(def.pattern));
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

function buildNumber(def: Record<string, any>): ZodTypeAny {
	let n = z.number();
	if (def.min != null) n = n.min(def.min);
	if (def.max != null) n = n.max(def.max);
	if (def.positive === true) n = n.positive();
	if (def.negative === true) n = n.negative();
	if (def.integer === true) n = n.int();
	return n;
}

function buildArray(def: Record<string, any>): ZodTypeAny {
	const itemSchema = def.items ? parseFieldDef(def.items) : z.any();
	return z.array(itemSchema);
}

function buildObject(def: Record<string, any>): ZodTypeAny {
	if (def.props) {
		const shape: Record<string, ZodTypeAny> = {};
		for (const [key, val] of Object.entries(def.props)) {
			shape[key] = parseFieldDef(val);
		}
		return z.object(shape);
	}
	return z.object({});
}

function buildEnum(def: Record<string, any>): ZodTypeAny {
	if (Array.isArray(def.values) && def.values.length > 0) {
		const allStrings = def.values.every((v: unknown) => typeof v === "string");
		if (allStrings) return z.enum(def.values as [string, ...string[]]);
		const literals = def.values.map((v: string | number | boolean) => z.literal(v));
		return z.union(literals as unknown as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
	}
	return z.any();
}

function parsePipeSyntax(pipe: string): Record<string, any> {
	const parts = pipe.split("|");
	const type = parts[0];
	const def: Record<string, any> = { type };
	for (let i = 1; i < parts.length; i++) {
		const part = parts[i];
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
				break;
		}
	}
	return def;
}

function parseFieldDef(field: any): ZodTypeAny {
	if (typeof field === "string") {
		if (field.includes("|")) {
			return convertSingleField(parsePipeSyntax(field));
		}
		return convertSingleField({ type: field });
	}
	if (typeof field === "object" && field !== null) {
		return convertSingleField(field);
	}
	return z.any();
}

export function convertFastestValidatorToZod(schema: Record<string, any>): Record<string, ZodTypeAny> {
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

export function convertActionParamsToZod(params: any): Record<string, ZodTypeAny> {
	if (params == null) return {};
	if (typeof params === "string") {
		return convertFastestValidatorToZod({ $$root: true, type: params });
	}
	if (typeof params === "object") {
		return convertFastestValidatorToZod(params);
	}
	return {};
}
