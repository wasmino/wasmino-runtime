import fetch from "cross-fetch";
import { atob } from "abab";

import { WASI, WASIBindings } from "@wasmer/wasi";

async function sleep(ms: number) {
	await new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

interface WasminoExports {
	memory: WebAssembly.Memory;

	_start: () => void;

	asyncify_start_unwind: (addr: number) => void;
	asyncify_stop_unwind: () => void;
	asyncify_start_rewind: (addr: number) => void;
	asyncify_stop_rewind: () => void;

	wasminoGetPinMode: (pin: number) => number;
	wasminoGetPinCount: () => number;

	wasminoWritePin: (pin: number, value: number) => void;
	wasminoReadPin: (pin: number) => number;

	wasminoSetUptime: (s: number, ns: number) => void;

	malloc: (size: number) => number;
	free: (ptr: number) => void;
};

export default class Wasmino {
	public running: boolean = false;
	public initialized: boolean = false;

	private intervalHandle: number = 0;

	private wasmURL: string | undefined;
	private wasmArrayBuffer: ArrayBuffer | undefined;

	private instance: WebAssembly.Instance | undefined;
	private asyncifyPtr: number | undefined;

	// timestamp in nanoseconds
	private hostClock: bigint = BigInt(0);
	private clientClock: bigint = BigInt(0);

	private clientSleeping: boolean = false;
	constructor(wasm: string | ArrayBuffer, private wasiBindings: WASIBindings) {
		if (typeof (wasm) === "string") {
			this.wasmURL = wasm;
		} else {
			this.wasmArrayBuffer = wasm;
		}
	}
	async init() {
		let responseArrayBuffer = this.wasmArrayBuffer;
		if (responseArrayBuffer === undefined) {
			const response = await fetch(this.wasmURL!);
			responseArrayBuffer = await response.arrayBuffer();
		}
		const responseUint8Array = new Uint8Array(responseArrayBuffer);
		let wasmArrayBuffer = responseArrayBuffer;
		if (String.fromCharCode(responseUint8Array[0]) === "A") {
			// probably base64 encoded wasm
			const decoder = new TextDecoder();
			let b64String = decoder.decode(responseArrayBuffer);
			let bytesString = atob(b64String)!;
			let bytes = new Array(bytesString.length);
			for (let i = 0; i < bytesString.length; i++) {
				bytes[i] = bytesString.charCodeAt(i);
			}
			wasmArrayBuffer = new Uint8Array(bytes).buffer;
		}
		const wasi = new WASI({
			args: [],
			env: {},
			bindings: this.wasiBindings,
		});
		let module = await WebAssembly.compile(wasmArrayBuffer);
		let instance = await WebAssembly.instantiate(module, {
			...wasi.getImports(module),
			wasmino: {
				nanosleep: (s: number, ns: number) => {
					const exports = this.getExports();
					if (exports === undefined) {
						throw new Error("sleep called before initialization");
					}
					if (!this.clientSleeping) {
						if (this.asyncifyPtr === undefined) {
							// initialize asyncify pointer
							const asyncifyBufferSize = 4096;
							this.asyncifyPtr = exports.malloc(asyncifyBufferSize);
							const uint32Mem = new Uint32Array(exports.memory.buffer);
							uint32Mem[this.asyncifyPtr >> 2] = this.asyncifyPtr + 8;
							uint32Mem[(this.asyncifyPtr >> 2) + 1] = this.asyncifyPtr + asyncifyBufferSize;
						}
						exports.asyncify_start_unwind(this.asyncifyPtr);
						this.clientSleeping = true;
						this.clientClock = this.clientClock + BigInt(1e9) * BigInt(s) + BigInt(ns);
					} else {
						exports.asyncify_stop_rewind();
						this.clientSleeping = false;
					}
				}
			}
		});
		this.instance = instance;
		wasi.start(instance);
		this.initialized = true;
	}
	async run(ms: number) {
		if (this.running) {
			return;
		}
		if (!this.initialized) {
			await this.init();
		}
		this.intervalHandle = setInterval(() => {
			this.tick(ms);
		}, ms);
		this.running = true;
	}
	stop() {
		if (!this.running) {
			return;
		}
		clearInterval(this.intervalHandle);
		this.running = false;
	}
	tick(ms: number) {
		this.hostClock = this.hostClock + BigInt(ms * 1e6);
		this._tick();
	}
	nanoTick(s: number, ns: number) {
		this.hostClock = this.hostClock + BigInt(1e9) * BigInt(s) + BigInt(ns);
		this._tick();
	}
	readPin(pin: number): number {
		const exports = this.getExports();
		if (exports === undefined) {
			return 0;
		}
		return exports.wasminoReadPin(pin);
	}
	writePin(pin: number, value: number) {
		const exports = this.getExports();
		if (exports === undefined) {
			throw new Error("Not initialized");
		}
		// since a interrupt may trigger, which may read uptime, rollback time to host time, and revert after.
		exports.wasminoSetUptime(Number(this.hostClock / BigInt(1e9)), Number(this.hostClock % BigInt(1e9)));
		exports.wasminoWritePin(pin, value);
		exports.wasminoSetUptime(Number(this.clientClock / BigInt(1e9)), Number(this.clientClock % BigInt(1e9)));
		return;
	}
	getPinCount(): number {
		const exports = this.getExports();
		if (exports === undefined) {
			throw new Error("Not initialized");
		}
		return exports.wasminoGetPinCount();
	}
	getPinMode(pin: number): number {
		const exports = this.getExports();
		if (exports === undefined) {
			throw new Error("Not initialized");
		}
		return exports.wasminoGetPinMode(pin);
	}
	private getExports(): WasminoExports | undefined {
		if (this.instance === undefined) {
			return undefined;
		}
		return this.instance.exports as unknown as WasminoExports;
	}
	private _tick() {
		const exports = this.getExports();
		if (exports === undefined) {
			throw new Error("Cannot tick before initialization");
		}
		while (this.clientClock < this.hostClock) {
			// when hostClock is ahead of clientClock, repeat execution.
			exports.asyncify_start_rewind(this.asyncifyPtr!);
			exports._start();
			exports.asyncify_stop_unwind();
		}
	}
}
