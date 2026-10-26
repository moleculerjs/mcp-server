// @ts-check

import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import globals from "globals";

export default defineConfig(
	eslint.configs.recommended,
	tseslint.configs.recommended,
	eslintPluginPrettierRecommended,
	{
		languageOptions: {
			globals: {
				...globals.node
			}
		},
		rules: {
			"@/no-var": ["error"],
			"@/no-console": ["warn"],
			"@typescript-eslint/no-unused-vars": ["warn"],
			"@/no-trailing-spaces": ["error"],
			"@/no-process-exit": ["off"],
			"@/object-curly-spacing": ["warn", "always"]
		}
	}
);
