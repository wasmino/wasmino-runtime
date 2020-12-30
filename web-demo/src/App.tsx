import React, { useEffect } from "react";
import "./App.css";

import Wasmino from "@wasmino/runtime";
import wasiBindings from "@wasmer/wasi/lib/bindings/browser";

const TICK_MS = 50;

const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
const defaultWasmSrc = params.get("src") ?? "";
let defaultPins = {};
try {
	defaultPins = JSON.parse(params.get("pins") ?? "{}");
} catch (e) {
	console.warn("Cannot parse pins config, defaulting to empty");
}

let wasmino = new Wasmino("", wasiBindings);

enum PinType {
	LED = "led",
	SWITCH = "switch",
}

interface PinCommonProps {
	text?: string;
	onClose?: () => void;
}

interface InputPin extends PinCommonProps {
	onChange?: (value: boolean) => void;
}

interface OutputPin extends PinCommonProps {
	value: number;
}

interface LedPinProps extends OutputPin {
	type: PinType.LED;
	color: string;
}

interface SwitchPinProps extends InputPin {
	type: PinType.SWITCH;
}

type PinProps = LedPinProps | SwitchPinProps;

const LedComponent = (props: LedPinProps) => {
	// console.log(props.value);
	return (
		<div className="component">
			<div
				className="led"
				style={{ backgroundColor: `rgba(${props.color}, ${props.value})` }}
			></div>
			<div className="pin-name">{props.text}</div>
			<div className="close" onClick={props.onClose}>
				x
			</div>
		</div>
	);
};

const SwitchComponent = (props: SwitchPinProps) => {
	return (
		<div className="component">
			<label className="switch">
				<input
					type="checkbox"
					onChange={(e) => {
						if (props.onChange === undefined) {
							return;
						}
						props.onChange(e.currentTarget.checked);
					}}
				/>
				<span className="slider round"></span>
			</label>
			<div className="pin-name">{props.text}</div>
			<div className="close" onClick={props.onClose}>
				x
			</div>
		</div>
	);
};

const Component = (props: PinProps) => {
	switch (props.type) {
		case PinType.LED:
			return <LedComponent {...props} />;
		case PinType.SWITCH:
			return <SwitchComponent {...props} />;
		default:
			return <div />;
	}
};

interface Pins {
	[pinId: string]:
		| {
				type: PinType;
		  }
		| PinProps;
}

interface Outputs {
	[pinId: string]: number;
}

function App() {
	const [wasmSrc, setWasmSrc] = React.useState<string>(defaultWasmSrc);
	const [pinId, setPinId] = React.useState<number>();
	const [pins, setPins] = React.useState<Pins>(defaultPins);
	const [outputs, setOutputs] = React.useState<Outputs>({});
	const [running, setRunning] = React.useState<boolean>(wasmino.running);

	const params = new URLSearchParams();
	params.set("src", wasmSrc);
	params.set("pins", JSON.stringify(pins));
	window.location.hash = "#" + params.toString();

	const pinProps = (i: string): PinProps => {
		const type = pins[i].type;
		const value = outputs[i];
		const text = `PIN ${i}`;
		const onClose = () => {
			const pinsCopy = pins;
			delete pinsCopy[i];
			setPins(pinsCopy);
		};
		switch (type) {
			case PinType.LED:
				return { color: "0, 255, 0", ...pins[i], type, text, onClose, value };
			case PinType.SWITCH:
				return {
					...pins[i],
					type,
					text,
					onClose,
					onChange: (v) => {
						if (!wasmino.initialized) {
							return;
						}
						wasmino.writePin(Number(i), v ? 1 : 0);
					},
				};
		}
	};

	const run = async () => {
		if (wasmino.running) {
			return;
		}
		let wasmUrl = wasmSrc;
		try {
			if (wasmSrc.startsWith("gist://")) {
				const response = await fetch(
					"https://api.github.com/gists/" + wasmSrc.slice(7)
				);
				const responseJson = await response.json();
				wasmUrl = (Object.values(responseJson.files)[0] as any)["raw_url"];
			}
		} catch (e) {
			alert("Cannot fetch Gist, check Gist ID?");
		}
		try {
			wasmino = new Wasmino(wasmUrl, wasiBindings);
			setRunning(true);
			wasmino.run(TICK_MS);
		} catch (e) {
			console.error(e);
			alert("Cannot initialize Wasmino, check console logs for detail");
		}
	};

	const stop = () => {
		setRunning(false);
		wasmino.stop();
	};

	useEffect(() => {
		// read from outputs
		const intervalHandle = setInterval(() => {
			if (!wasmino.initialized) {
				return;
			}
			const newOutputs: Outputs = {};
			for (const key in pins) {
				const output = wasmino.readPin(Number(key));
				newOutputs[key] = output;
			}
			setOutputs(newOutputs);
		}, TICK_MS);
		return () => {
			clearInterval(intervalHandle);
		};
	});
	return (
		<div className="app">
			<div className="controls">
				<input
					placeholder="WASM URL"
					value={wasmSrc}
					onChange={(e) => {
						setWasmSrc(e.currentTarget.value);
					}}
				/>
				<button onClick={running ? stop : run}>
					{running ? "Stop" : "Run"}
				</button>
				<input
					type="number"
					placeholder="PIN number"
					onChange={(e) => {
						setPinId(e.currentTarget.valueAsNumber >> 0);
					}}
				/>
				<button
					onClick={() => {
						if (pinId === undefined || isNaN(pinId)) {
							return;
						}
						setPins({ ...pins, [pinId]: { type: PinType.LED } });
					}}
				>
					Add LED
				</button>
				<button
					onClick={() => {
						if (pinId === undefined || isNaN(pinId)) {
							return;
						}
						setPins({ ...pins, [pinId]: { type: PinType.SWITCH } });
					}}
				>
					Add Switch
				</button>
			</div>
			<div className="switchboard">
				{Object.keys(pins).map((k) => (
					<Component key={k} {...pinProps(k)} />
				))}
			</div>
		</div>
	);
}

export default App;
