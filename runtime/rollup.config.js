import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import compiler from "@ampproject/rollup-plugin-closure-compiler";

export default [
	// for browser use in a <script> tag
	{
		input: "src/index.ts",
		output: {
			name: "Wasmino",
			sourcemap: true,
			file: "dist/wasmino.js",
			format: "iife",
			compact: true,
		},
		plugins: [
			typescript({ tsconfig: "tsconfig.rollup.json" }),
			resolve({ mainFields: ["browser", "module"] }),
			commonjs(),
			compiler(),
		],
	}
];
