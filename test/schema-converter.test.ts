import { describe, it, expect } from "vitest";
import { convertFastestValidatorToZod, convertActionParamsToZod } from "../src/schema-converter.js";

describe("convertFastestValidatorToZod", () => {
	describe("basic types", () => {
		it("string shorthand", () => {
			const result = convertFastestValidatorToZod({ name: "string" });
			expect(result.name.parse("hello")).toBe("hello");
			expect(() => result.name.parse(123)).toThrow();
		});

		it("number shorthand", () => {
			const result = convertFastestValidatorToZod({ age: "number" });
			expect(result.age.parse(25)).toBe(25);
			expect(() => result.age.parse("abc")).toThrow();
		});

		it("boolean shorthand", () => {
			const result = convertFastestValidatorToZod({ active: "boolean" });
			expect(result.active.parse(true)).toBe(true);
			expect(() => result.active.parse("yes")).toThrow();
		});

		it("any type", () => {
			const result = convertFastestValidatorToZod({ data: { type: "any" } });
			expect(result.data.parse("anything")).toBe("anything");
			expect(result.data.parse(42)).toBe(42);
		});
	});

	describe("string constraints", () => {
		it("min and max", () => {
			const result = convertFastestValidatorToZod({
				name: { type: "string", min: 3, max: 100 }
			});
			expect(result.name.parse("hello")).toBe("hello");
			expect(() => result.name.parse("ab")).toThrow();
			expect(() => result.name.parse("x".repeat(101))).toThrow();
		});

		it("pattern", () => {
			const result = convertFastestValidatorToZod({
				code: { type: "string", pattern: "^[A-Z]+$" }
			});
			expect(result.code.parse("ABC")).toBe("ABC");
			expect(() => result.code.parse("abc")).toThrow();
		});

		it("enum values on string", () => {
			const result = convertFastestValidatorToZod({
				color: { type: "string", enum: ["red", "green", "blue"] }
			});
			expect(result.color.parse("red")).toBe("red");
			expect(() => result.color.parse("yellow")).toThrow();
		});

		it("email", () => {
			const result = convertFastestValidatorToZod({ email: { type: "email" } });
			expect(result.email.parse("test@test.com")).toBe("test@test.com");
			expect(() => result.email.parse("notanemail")).toThrow();
		});

		it("url", () => {
			const result = convertFastestValidatorToZod({ url: { type: "url" } });
			expect(result.url.parse("https://example.com")).toBe("https://example.com");
			expect(() => result.url.parse("notaurl")).toThrow();
		});
	});

	describe("number constraints", () => {
		it("positive and integer", () => {
			const result = convertFastestValidatorToZod({
				count: { type: "number", positive: true, integer: true }
			});
			expect(result.count.parse(5)).toBe(5);
			expect(() => result.count.parse(-1)).toThrow();
			expect(() => result.count.parse(1.5)).toThrow();
		});

		it("min and max", () => {
			const result = convertFastestValidatorToZod({
				score: { type: "number", min: 0, max: 100 }
			});
			expect(result.score.parse(50)).toBe(50);
			expect(() => result.score.parse(-1)).toThrow();
			expect(() => result.score.parse(101)).toThrow();
		});

		it("negative", () => {
			const result = convertFastestValidatorToZod({
				temp: { type: "number", negative: true }
			});
			expect(result.temp.parse(-5)).toBe(-5);
			expect(() => result.temp.parse(5)).toThrow();
		});
	});

	describe("array", () => {
		it("array with string items", () => {
			const result = convertFastestValidatorToZod({
				tags: { type: "array", items: "string" }
			});
			expect(result.tags.parse(["a", "b"])).toEqual(["a", "b"]);
			expect(() => result.tags.parse([1, 2])).toThrow();
		});

		it("array with object items", () => {
			const result = convertFastestValidatorToZod({
				items: { type: "array", items: { type: "object", props: { id: "number" } } }
			});
			expect(result.items.parse([{ id: 1 }])).toEqual([{ id: 1 }]);
		});
	});

	describe("object", () => {
		it("object with props", () => {
			const result = convertFastestValidatorToZod({
				address: { type: "object", props: { city: "string", zip: "number" } }
			});
			const parsed = result.address.parse({ city: "NYC", zip: 10001 });
			expect(parsed).toEqual({ city: "NYC", zip: 10001 });
		});

		it("nested objects", () => {
			const result = convertFastestValidatorToZod({
				user: {
					type: "object",
					props: {
						name: "string",
						address: {
							type: "object",
							props: {
								street: "string",
								city: "string"
							}
						}
					}
				}
			});
			const parsed = result.user.parse({
				name: "John",
				address: { street: "123 Main", city: "NYC" }
			});
			expect(parsed.name).toBe("John");
			expect(parsed.address.city).toBe("NYC");
		});
	});

	describe("enum type", () => {
		it("enum with values", () => {
			const result = convertFastestValidatorToZod({
				status: { type: "enum", values: ["active", "inactive"] }
			});
			expect(result.status.parse("active")).toBe("active");
			expect(() => result.status.parse("unknown")).toThrow();
		});
	});

	describe("date type", () => {
		it("date converts to string", () => {
			const result = convertFastestValidatorToZod({ created: { type: "date" } });
			expect(result.created.parse("2024-01-01")).toBe("2024-01-01");
		});
	});

	describe("optional and default", () => {
		it("optional field", () => {
			const result = convertFastestValidatorToZod({
				name: { type: "string", optional: true }
			});
			expect(result.name.parse(undefined)).toBeUndefined();
			expect(result.name.parse("hello")).toBe("hello");
		});

		it("default value", () => {
			const result = convertFastestValidatorToZod({
				count: { type: "number", default: 5 }
			});
			expect(result.count.parse(undefined)).toBe(5);
			expect(result.count.parse(10)).toBe(10);
		});
	});

	describe("pipe syntax", () => {
		it("number|integer|positive", () => {
			const result = convertFastestValidatorToZod({
				id: "number|integer|positive"
			});
			expect(result.id.parse(5)).toBe(5);
			expect(() => result.id.parse(-1)).toThrow();
			expect(() => result.id.parse(1.5)).toThrow();
		});

		it("string|optional", () => {
			const result = convertFastestValidatorToZod({
				name: "string|optional"
			});
			expect(result.name.parse(undefined)).toBeUndefined();
			expect(result.name.parse("hello")).toBe("hello");
		});
	});

	describe("unknown/custom type", () => {
		it("unknown type becomes z.any()", () => {
			const result = convertFastestValidatorToZod({
				custom: { type: "customValidator" }
			});
			expect(result.custom.parse("anything")).toBe("anything");
			expect(result.custom.parse(42)).toBe(42);
		});
	});

	describe("$$root handling", () => {
		it("$$root: true wraps as root schema", () => {
			const result = convertFastestValidatorToZod({
				$$root: true,
				type: "string"
			});
			expect(result.$$root).toBeDefined();
			expect(result.$$root.parse("hello")).toBe("hello");
		});

		it("$$root: true with object type", () => {
			const result = convertFastestValidatorToZod({
				$$root: true,
				type: "object",
				props: { name: "string" }
			});
			expect(result.$$root.parse({ name: "John" })).toEqual({ name: "John" });
		});
	});
});

describe("convertActionParamsToZod", () => {
	it("undefined params returns empty object", () => {
		expect(convertActionParamsToZod(undefined)).toEqual({});
	});

	it("null params returns empty object", () => {
		expect(convertActionParamsToZod(null)).toEqual({});
	});

	it("string shorthand", () => {
		const result = convertActionParamsToZod("string");
		expect(result.$$root).toBeDefined();
		expect(result.$$root.parse("hello")).toBe("hello");
	});

	it("object params", () => {
		const result = convertActionParamsToZod({
			name: "string",
			age: { type: "number", optional: true }
		});
		expect(result.name.parse("John")).toBe("John");
		expect(result.age.parse(undefined)).toBeUndefined();
	});
});

describe("fork additions", () => {
	it("pipe syntax with key:value options", () => {
		const result = convertFastestValidatorToZod({
			name: "string|min:3|max:5",
			age: "number|integer|min:18",
			nick: "string|nullable|optional"
		});
		expect(result.name.parse("abcd")).toBe("abcd");
		expect(() => result.name.parse("ab")).toThrow();
		expect(() => result.name.parse("abcdef")).toThrow();
		expect(result.age.parse(18)).toBe(18);
		expect(() => result.age.parse(17)).toThrow();
		expect(result.nick.parse(null)).toBeNull();
		expect(result.nick.parse(undefined)).toBeUndefined();
	});

	it("$$root with pipe syntax", () => {
		const result = convertActionParamsToZod("string|min:3");
		expect(result.$$root.parse("abc")).toBe("abc");
		expect(() => result.$$root.parse("ab")).toThrow();
	});

	it("description is forwarded to the schema", () => {
		const result = convertFastestValidatorToZod({
			city: { type: "string", description: "Name of the city" }
		});
		expect(result.city.description).toBe("Name of the city");
	});

	it("nullable", () => {
		const result = convertFastestValidatorToZod({ value: { type: "number", nullable: true } });
		expect(result.value.parse(null)).toBeNull();
		expect(() => result.value.parse(undefined)).toThrow();
	});

	it("uuid", () => {
		const result = convertFastestValidatorToZod({ id: "uuid" });
		expect(result.id.parse("2f1e6a1c-6a3b-4c1e-9a7f-1b2c3d4e5f60")).toBeDefined();
		expect(() => result.id.parse("not-a-uuid")).toThrow();
	});

	it("multi rule (explicit and array shorthand)", () => {
		const result = convertFastestValidatorToZod({
			a: { type: "multi", rules: ["string", "number"] },
			b: [{ type: "string" }, { type: "boolean" }]
		});
		expect(result.a.parse("x")).toBe("x");
		expect(result.a.parse(1)).toBe(1);
		expect(() => result.a.parse(true)).toThrow();
		expect(result.b.parse(true)).toBe(true);
		expect(() => result.b.parse(1)).toThrow();
	});

	it("object with `properties` alias", () => {
		const result = convertFastestValidatorToZod({
			user: { type: "object", properties: { name: "string" } }
		});
		expect(result.user.parse({ name: "John" })).toEqual({ name: "John" });
		expect(() => result.user.parse({ name: 1 })).toThrow();
	});

	it("array and string length constraints", () => {
		const result = convertFastestValidatorToZod({
			tags: { type: "array", items: "string", min: 1, max: 2 },
			code: { type: "string", length: 3 },
			text: { type: "string", empty: false }
		});
		expect(() => result.tags.parse([])).toThrow();
		expect(() => result.tags.parse(["a", "b", "c"])).toThrow();
		expect(result.tags.parse(["a"])).toEqual(["a"]);
		expect(() => result.code.parse("ab")).toThrow();
		expect(() => result.text.parse("")).toThrow();
	});
});

describe("fastest-validator compatibility", () => {
	it("object without props keeps all the properties", () => {
		const result = convertFastestValidatorToZod({ filter: { type: "object" } });
		expect(result.filter.parse({ a: 1, b: { c: "x" } })).toEqual({ a: 1, b: { c: "x" } });
	});

	it("object with props keeps unknown properties, unless strict", () => {
		const result = convertFastestValidatorToZod({
			loose: { type: "object", props: { a: "number" } },
			remove: { type: "object", strict: "remove", props: { a: "number" } },
			strict: { type: "object", strict: true, props: { a: "number" } }
		});
		expect(result.loose.parse({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
		expect(result.remove.parse({ a: 1, b: 2 })).toEqual({ a: 1 });
		expect(() => result.strict.parse({ a: 1, b: 2 })).toThrow();
	});

	it("nested object shorthand with $$type", () => {
		const result = convertFastestValidatorToZod({
			address: { $$type: "object|optional", city: "string", zip: "number" }
		});
		expect(result.address.parse(undefined)).toBeUndefined();
		expect(result.address.parse({ city: "Rome", zip: 100 })).toEqual({
			city: "Rome",
			zip: 100
		});
		expect(() => result.address.parse({ city: "Rome" })).toThrow();
	});

	it("dynamic default makes the field optional, without a static default", () => {
		const result = convertFastestValidatorToZod({
			createdAt: { type: "number", default: () => Date.now() }
		});
		expect(result.createdAt.parse(undefined)).toBeUndefined();
		expect(result.createdAt.parse(5)).toBe(5);
	});

	it("pattern with patternFlags", () => {
		const result = convertFastestValidatorToZod({
			code: { type: "string", pattern: "^abc$", patternFlags: "i" }
		});
		expect(result.code.parse("ABC")).toBe("ABC");
		expect(() => result.code.parse("abd")).toThrow();
	});
});

describe("less common rules", () => {
	it("ignores the $$ options of the params schema", () => {
		const result = convertFastestValidatorToZod({
			$$strict: true,
			$$async: true,
			name: "string"
		});
		expect(Object.keys(result)).toEqual(["name"]);
	});

	it("email and url flags in the pipe syntax and as string options", () => {
		const result = convertFastestValidatorToZod({
			a: "string|email",
			b: "string|url",
			c: { type: "string", email: true },
			d: { type: "string", url: true }
		});
		for (const key of ["a", "c"]) {
			expect(result[key].parse("john@example.com")).toBe("john@example.com");
			expect(() => result[key].parse("john")).toThrow();
		}
		for (const key of ["b", "d"]) {
			expect(result[key].parse("https://example.com")).toBe("https://example.com");
			expect(() => result[key].parse("example")).toThrow();
		}
	});

	it("email and url pipe flags on another type set the type", () => {
		const result = convertFastestValidatorToZod({ a: "any|email", b: "any|url" });
		expect(() => result.a.parse("john")).toThrow();
		expect(() => result.b.parse("example")).toThrow();
	});

	it("mixed enums become unions of literals", () => {
		const result = convertFastestValidatorToZod({
			level: { type: "enum", values: [1, 2, "max"] },
			flag: { type: "string", enum: ["on", true] }
		});
		expect(result.level.parse(2)).toBe(2);
		expect(result.level.parse("max")).toBe("max");
		expect(() => result.level.parse(3)).toThrow();
		expect(result.flag.parse(true)).toBe(true);
		expect(() => result.flag.parse("off")).toThrow();
	});

	it("enum without values accepts anything", () => {
		const result = convertFastestValidatorToZod({ a: { type: "enum", values: [] } });
		expect(result.a.parse("x")).toBe("x");
	});

	it("array with empty: false and negative numbers", () => {
		const result = convertFastestValidatorToZod({
			tags: { type: "array", items: "string", empty: false },
			delta: "number|negative"
		});
		expect(() => result.tags.parse([])).toThrow();
		expect(result.tags.parse(["a"])).toEqual(["a"]);
		expect(result.delta.parse(-1)).toBe(-1);
		expect(() => result.delta.parse(1)).toThrow();
	});

	it("boolean and numeric pipe values", () => {
		const result = convertFastestValidatorToZod({
			text: "string|empty:false|max:3",
			code: "string|empty:true"
		});
		expect(() => result.text.parse("")).toThrow();
		expect(() => result.text.parse("abcd")).toThrow();
		expect(result.code.parse("")).toBe("");
	});

	it("multi without rules and invalid field definitions accept anything", () => {
		const result = convertFastestValidatorToZod({
			a: { type: "multi", rules: [] },
			b: { type: "multi", rules: ["string"] },
			c: 42 as unknown as string
		});
		expect(result.a.parse(1)).toBe(1);
		expect(result.b.parse("x")).toBe("x");
		expect(() => result.b.parse(1)).toThrow();
		expect(result.c.parse({ x: 1 })).toEqual({ x: 1 });
	});

	it("array length and equal with a non-primitive value", () => {
		const result = convertFastestValidatorToZod({
			pair: { type: "array", items: "number", length: 2 },
			same: { type: "equal", value: { a: 1 } }
		});
		expect(result.pair.parse([1, 2])).toEqual([1, 2]);
		expect(() => result.pair.parse([1])).toThrow();
		// Object equality can't be expressed in JSON Schema: left to the action's validator
		expect(result.same.parse({ b: 2 })).toEqual({ b: 2 });
	});

	it("non-object action params produce no input schema", () => {
		expect(convertActionParamsToZod(42)).toEqual({});
		expect(convertActionParamsToZod(true)).toEqual({});
	});
});
