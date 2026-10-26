import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { convertFastestValidatorToZod } from "../src/schema-converter.js";

// Convert a single field and return its Zod schema
function field(def: unknown) {
	return convertFastestValidatorToZod({ value: def }).value;
}

// JSON Schema of a single field, as sent to the LLM in tools/list
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jsonSchema(def: unknown): any {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const schema = zodToJsonSchema(z.object({ value: field(def) })) as any;
	return schema.properties.value;
}

describe("schema converter: string flag patterns", () => {
	const cases: Array<[string, string[], string[]]> = [
		["alpha", ["abc", "ABC"], ["ab1", "a b", ""]],
		["numeric", ["123", "-12", "1.5"], ["12a", "1.", "abc"]],
		["alphanum", ["abc123"], ["abc-123", "a b"]],
		["alphadash", ["abc_1-2"], ["abc.1", "a b"]],
		["hex", ["0aF9"], ["0xG1", "g"]],
		["base64", ["aGVsbG8=", "aGVsbG8gd29ybGQ="], ["aGVsbG8", "a$b="]],
		["singleLine", ["one line"], ["two\nlines", "two\r\nlines"]]
	];

	for (const [flag, valid, invalid] of cases) {
		it(`${flag}`, () => {
			const schema = field({ type: "string", [flag]: true });
			for (const v of valid) expect(schema.parse(v), v).toBe(v);
			for (const v of invalid) expect(() => schema.parse(v), v).toThrow();
		});
	}

	it("flags in pipe syntax", () => {
		const schema = field("string|alpha|max:3");
		expect(schema.parse("abc")).toBe("abc");
		expect(() => schema.parse("ab1")).toThrow();
		expect(() => schema.parse("abcd")).toThrow();
	});

	it("flags are combined with the other string rules", () => {
		const schema = field({ type: "string", hex: true, length: 4 });
		expect(schema.parse("beef")).toBe("beef");
		expect(() => schema.parse("bee")).toThrow();
		expect(() => schema.parse("beeg")).toThrow();
	});

	it("patterns are exported to the JSON Schema", () => {
		expect(jsonSchema({ type: "string", alpha: true }).pattern).toBe("^[a-zA-Z]+$");
		expect(jsonSchema({ type: "string", hex: true }).pattern).toBe("^[0-9a-fA-F]+$");
	});
});

describe("schema converter: mac", () => {
	it("accepts the fastest-validator MAC formats, in any case", () => {
		const schema = field("mac");
		for (const v of ["01:C8:95:4B:65:FE", "01-c8-95-4b-65-fe", "01c8.954b.65fe"]) {
			expect(schema.parse(v), v).toBe(v);
		}
	});

	it("rejects invalid MAC addresses", () => {
		const schema = field("mac");
		for (const v of ["01:C8:95:4B:65", "01:C8:95:4B:65:FG", "not a mac"]) {
			expect(() => schema.parse(v), v).toThrow();
		}
	});

	it("exports a case-insensitive pattern without RegExp flags", () => {
		const { type, pattern } = jsonSchema("mac");
		expect(type).toBe("string");
		expect(new RegExp(pattern).test("01:C8:95:4b:65:fe")).toBe(true);
	});
});

describe("schema converter: currency", () => {
	it("default format", () => {
		const schema = field("currency");
		for (const v of ["1,000.50", "100", "-12.5", "0.99"]) expect(schema.parse(v), v).toBe(v);
		for (const v of ["1.000,50", "12.345", "abc", "$100"]) {
			expect(() => schema.parse(v), v).toThrow();
		}
	});

	it("mandatory and optional currency symbol", () => {
		const mandatory = field({ type: "currency", currencySymbol: "$" });
		expect(mandatory.parse("$1,000.50")).toBe("$1,000.50");
		expect(() => mandatory.parse("1,000.50")).toThrow();

		const optional = field({ type: "currency", currencySymbol: "$", symbolOptional: true });
		expect(optional.parse("$10")).toBe("$10");
		expect(optional.parse("10")).toBe("10");
	});

	it("custom separators", () => {
		const schema = field({ type: "currency", thousandSeparator: ".", decimalSeparator: "," });
		expect(schema.parse("1.000,50")).toBe("1.000,50");
		expect(() => schema.parse("1,000.50")).toThrow();
	});

	it("custom regex", () => {
		const schema = field({ type: "currency", customRegex: /^\d+ EUR$/ });
		expect(schema.parse("10 EUR")).toBe("10 EUR");
		expect(() => schema.parse("10")).toThrow();
	});
});

describe("schema converter: luhn", () => {
	it("is a string with an explanatory description", () => {
		const schema = field("luhn");
		expect(schema.parse("4111 1111 1111 1111")).toBe("4111 1111 1111 1111");
		expect(() => schema.parse(4111)).toThrow();
		expect(schema.description).toContain("Luhn");
	});

	it("an explicit description wins", () => {
		expect(field({ type: "luhn", description: "Credit card" }).description).toBe("Credit card");
	});
});

describe("schema converter: tuple", () => {
	it("validates each position", () => {
		const schema = field({ type: "tuple", items: ["number", "string"] });
		expect(schema.parse([1, "a"])).toEqual([1, "a"]);
		expect(() => schema.parse(["a", 1])).toThrow();
		expect(() => schema.parse([1])).toThrow();
	});

	it("without items is a generic array", () => {
		expect(field({ type: "tuple" }).parse([1, "a", true])).toEqual([1, "a", true]);
	});

	it("is exported as a fixed-length array", () => {
		const schema = jsonSchema({ type: "tuple", items: ["number", "string"] });
		expect(schema.type).toBe("array");
		expect(schema.minItems).toBe(2);
		expect(schema.maxItems).toBe(2);
	});
});

describe("schema converter: record", () => {
	it("defaults to string keys and any value", () => {
		expect(field({ type: "record" }).parse({ a: 1, b: "x" })).toEqual({ a: 1, b: "x" });
	});

	it("validates keys and values", () => {
		const schema = field({
			type: "record",
			key: { type: "string", alpha: true },
			value: "number"
		});
		expect(schema.parse({ abc: 1 })).toEqual({ abc: 1 });
		expect(() => schema.parse({ abc: "1" })).toThrow();
		expect(() => schema.parse({ a1: 1 })).toThrow();
	});
});

describe("schema converter: equal", () => {
	it("primitive values become literals", () => {
		const schema = field({ type: "equal", value: "yes" });
		expect(schema.parse("yes")).toBe("yes");
		expect(() => schema.parse("no")).toThrow();
		expect(field({ type: "equal", value: 5 }).parse(5)).toBe(5);
		expect(field({ type: "equal", value: true }).parse(true)).toBe(true);
	});

	it("equality with another field is not checked", () => {
		const schema = field({ type: "equal", field: "password" });
		expect(schema.parse("anything")).toBe("anything");
	});

	it("is exported as a constant", () => {
		expect(jsonSchema({ type: "equal", value: "yes" }).const).toBe("yes");
	});
});
