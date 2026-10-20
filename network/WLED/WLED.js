import udp from "@SignalRGB/udp";

/* ============================================================
 *  WLED UDP  -  SignalRGB network plugin
 *  Pure UDP (DRGB realtime) driver, adapted for ESPHome's
 *  `light -> effects: - wled:` component.
 *  No HTTP / port 80 dependency at all.
 * ============================================================ */

export function Name() { return "WLED UDP"; }
export function Version() { return "1.0.0"; }
export function Type() { return "network"; }
export function Publisher() { return "FeuerSturm"; }
export function Documentation() { return "gettingstarted/srgbmods-net-info"; }
export function Size() { return [1, 1]; }
export function DefaultPosition() { return [0, 0]; }
export function DefaultScale() { return 1.0; }
export function SubdeviceController() { return true; }
export function DefaultComponentBrand() { return "CompGen"; }
export function ImageUrl() { return "https://raw.githubusercontent.com/SRGBmods/public/main/images/wled/998_led_nodemcu.png"; }

/* global
controller:readonly
device:readonly
service:readonly
discovery:readonly
LightingMode:readonly
forcedColor:readonly
turnOffOnShutdown:readonly
defaultLedCount:readonly
defaultUdpPort:readonly
*/

export function ControllableParameters() {
	return [
		{"property":"LightingMode", "group":"settings", "label":"Lighting Mode", "type":"combobox", "values":["Canvas", "Forced"], "default":"Canvas"},
		{"property":"forcedColor", "group":"settings", "label":"Forced Color", "min":"0", "max":"360", "type":"color", "default":"#009bde"},
		{"property":"turnOffOnShutdown", "group":"settings", "label":"Turn device OFF on Shutdown", "type":"boolean", "default":"false"},
		{"property":"defaultLedCount", "group":"settings", "label":"Default LED Count (new devices)", "type":"number", "min":"1", "max":"2000", "default":"60"},
		{"property":"defaultUdpPort", "group":"settings", "label":"Default UDP Port", "type":"number", "min":"1", "max":"65535", "default":"21324"},
	];
}

/* ------------------------------------------------------------
 *  Realtime packet format (WLED "DNRGB" / 0x04)
 *    byte 0 : 0x04            protocol
 *    byte 1 : timeout (s)     keep frame alive
 *    byte 2 : start index HI
 *    byte 3 : start index LO
 *    byte 4+: R G B  (3 bytes per LED)
 *
 *  ESPHome parses exactly this in
 *  esphome/components/wled/wled_light_effect.cpp
 *  (parse_dnrgb_frame_), so the same packet drives both
 *  WLED firmware and an ESPHome `wled` effect.
 * ------------------------------------------------------------ */
const PROTOCOL_DNRGB = 0x04;
const REALTIME_TIMEOUT = 2;
const MAX_LEDS_PER_PACKET = 485;   // 485 * 3 + 4 = 1459 bytes (UDP payload limit 1472)
const COLOR_BLACK = "#000000";
const MAX_LED_COUNT = 2000;
const DEFAULT_LED_COUNT = 60;
const DEFAULT_UDP_PORT = 21324;

let socket;
let auxSocket;
let activeDevice;

/* ---------------------------- helpers ---------------------------- */

function clampInt(value, min, max, fallback) {
	const parsed = parseInt(value, 10);

	if (isNaN(parsed)) {
		return fallback;
	}

	return Math.min(max, Math.max(min, parsed));
}

function resolveLedCount(value) {
	const fallback = clampInt(typeof defaultLedCount !== "undefined" ? defaultLedCount : DEFAULT_LED_COUNT, 1, MAX_LED_COUNT, DEFAULT_LED_COUNT);
	return clampInt(value, 1, MAX_LED_COUNT, fallback);
}

function resolveUdpPort(value) {
	const fallback = clampInt(typeof defaultUdpPort !== "undefined" ? defaultUdpPort : DEFAULT_UDP_PORT, 1, 65535, DEFAULT_UDP_PORT);
	return clampInt(value, 1, 65535, fallback);
}

function isIPv4(address) {
	return typeof address === "string" && /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(address);
}

function hasValue(value) {
	return value !== undefined && value !== null && String(value).length > 0;
}

/* SignalRGB channel names should not contain dots (they break internal lookups). */
function defaultDeviceName(ip) {
	return "ESPHome " + String(ip).replace(/\./g, "-");
}

/* Stable, dot free, MAC style device id: 192.168.44.172 -> ESP-C0A82CAC */
function deviceId(ip) {
	const octets = String(ip).split(".").map((part) => ("0" + clampInt(part, 0, 255, 0).toString(16).toUpperCase()).slice(-2));
	return "ESP-" + octets.join("");
}

function firstValue() {
	for (let i = 0; i < arguments.length; i++) {
		if (hasValue(arguments[i])) {
			return arguments[i];
		}
	}

	return undefined;
}

function isEnabled(value) {
	return value === true || value === "true" || value === 1 || value === "1";
}

/* Always work with a plain Array of integers. */
function toPlainArray(colors) {
	if (Array.isArray(colors)) {
		return colors;
	}

	const copy = [];
	const length = colors === undefined || colors === null ? 0 : colors.length;

	for (let i = 0; i < length; i++) {
		copy.push(colors[i]);
	}

	return copy;
}

/* Write a full frame as one or more DNRGB packets. */
function writeFrame(target, ip, port, rgbData, ledCount, timeout) {
	const colors = toPlainArray(rgbData);
	const totalLeds = Math.min(ledCount, Math.floor(colors.length / 3));
	const packetCount = Math.ceil(totalLeds / MAX_LEDS_PER_PACKET);
	const keepAlive = timeout === undefined ? REALTIME_TIMEOUT : timeout;
	let offset = 0;

	for (let packet = 0; packet < packetCount; packet++) {
		const ledsInPacket = Math.min(MAX_LEDS_PER_PACKET, totalLeds - offset);
		const payload = [
			PROTOCOL_DNRGB,
			keepAlive,
			(offset >> 8) & 0xFF,
			offset & 0xFF,
		].concat(colors.slice(offset * 3, (offset + ledsInPacket) * 3));

		target.write(payload, ip, port);
		offset += ledsInPacket;
	}
}

function auxSocketGet() {
	if (auxSocket === undefined) {
		auxSocket = udp.createSocket();
	}

	return auxSocket;
}

/* Send a single black frame without needing a running plugin instance. */
function sendBlackout(ip, port, ledCount) {
	if (!isIPv4(ip)) {
		return;
	}

	writeFrame(auxSocketGet(), ip, port, new Array(ledCount * 3).fill(0), ledCount);
}

function hueToRgb(hue) {
	const sector = Math.floor(hue * 6) % 6;
	const frac = hue * 6 - Math.floor(hue * 6);
	const up = Math.round(frac * 255);
	const down = Math.round((1 - frac) * 255);

	switch (sector) {
		case 0: return [255, up, 0];
		case 1: return [down, 255, 0];
		case 2: return [0, 255, up];
		case 3: return [0, down, 255];
		case 4: return [up, 0, 255];
		default: return [255, 0, down];
	}
}

/* UI "Test" button: push a rainbow straight from the plugin UDP stack.
 * timeout 255 = ESPHome/WLED never blanks it, so the strip stays lit. */
function sendTestFrame(ip, port, ledCount) {
	if (!isIPv4(ip)) {
		service.log("WLED UDP: test frame skipped, invalid IP '" + ip + "'");
		return;
	}

	const leds = clampInt(ledCount, 1, MAX_LED_COUNT, DEFAULT_LED_COUNT);
	const colors = [];

	for (let i = 0; i < leds; i++) {
		const rgb = hueToRgb((i / Math.max(1, leds)) % 1);
		colors.push(rgb[0], rgb[1], rgb[2]);
	}

	const target = auxSocketGet();

	for (let repeat = 0; repeat < 5; repeat++) {
		writeFrame(target, ip, port, colors, leds, 0xFF);
	}

	service.log("WLED UDP: test frame sent (rainbow) -> " + ip + ":" + port + " / " + leds + " LEDs");
}

/* ------------------------- rendering device ------------------------- */

class UDPRenderDevice {
	constructor(controller) {
		this.id = controller.id;
		this.name = controller.name;
		this.ip = controller.ip;
		this.udpPort = resolveUdpPort(controller.udpPort);
		this.ledCount = resolveLedCount(controller.deviceledcount);
		this.forceOff = false;
		this.warnedNoChannel = false;
		this.framesSent = 0;
	}

	setupChannel() {
		try {
			device.setLedLimit(this.ledCount);
		} catch (e) {
			service.log("WLED UDP: setLedLimit(" + this.ledCount + ") failed: " + e);
		}

		try {
			device.addChannel(this.name, this.ledCount);
		} catch (e) {
			service.log("WLED UDP: addChannel('" + this.name + "', " + this.ledCount + ") failed: " + e);
		}
	}

	findChannel() {
		let channel = device.channel(this.name);

		if (channel === undefined || channel === null) {
			channel = device.channel(0);
		}

		return channel === undefined || channel === null ? null : channel;
	}

	turnOn() {
		this.forceOff = false;
	}

	turnOff() {
		this.forceOff = true;
	}

	sendFrame() {
		if (!isIPv4(this.ip)) {
			return;
		}

		const channel = this.findChannel();

		if (channel === null) {
			if (!this.warnedNoChannel) {
				this.warnedNoChannel = true;
				service.log("WLED UDP: no channel named '" + this.name + "' - check the LED count / reload the plugin");
			}

			return;
		}

		const channelLeds = clampInt(channel.ledCount, 1, MAX_LED_COUNT, this.ledCount);
		let rgbData;

		if (this.forceOff) {
			rgbData = device.createColorArray(COLOR_BLACK, channelLeds, "Inline");
		} else if (LightingMode === "Forced") {
			rgbData = device.createColorArray(forcedColor, channelLeds, "Inline");
		} else if (channel.shouldPulseColors()) {
			rgbData = device.createColorArray(device.getChannelPulseColor(this.name), channelLeds, "Inline");
		} else {
			rgbData = channel.getColors("Inline");
		}

		writeFrame(socket, this.ip, this.udpPort, rgbData, channelLeds);
		this.framesSent++;

		if (this.framesSent === 1) {
			service.log("WLED UDP: first frame sent -> " + this.ip + ":" + this.udpPort + " (" + channelLeds + " LEDs)");
		} else if (this.framesSent % 1800 === 0) {
			service.log("WLED UDP: heartbeat, " + this.framesSent + " frames sent to " + this.ip);
		}
	}
}

/* --------------------------- plugin hooks --------------------------- */

export function Initialize() {
	service.log("WLED UDP: Initialize() for " + (controller === undefined ? "?" : controller.name));

	if (controller === undefined || controller === null) {
		return;
	}

	try {
		device.setName(controller.name);
	} catch (e) {
		service.log("WLED UDP: setName failed: " + e);
	}

	socket = udp.createSocket();
	activeDevice = new UDPRenderDevice(controller);
	activeDevice.setupChannel();
	service.log("WLED UDP driving " + controller.name + " at " + controller.ip + ":" + activeDevice.udpPort + " (" + activeDevice.ledCount + " LEDs)");
}

export function Render() {
	if (activeDevice === undefined) {
		return;
	}

	activeDevice.sendFrame();
}

export function Shutdown(suspend) {
	if (activeDevice !== undefined) {
		activeDevice.sendFrame();

		if (isEnabled(turnOffOnShutdown)) {
			activeDevice.turnOff();
			activeDevice.sendFrame();
		}

		activeDevice = undefined;
	}

	if (socket !== undefined) {
		try {
			socket.close();
		} catch (e) {
			/* already closed */
		}

		socket = undefined;
	}
}

/* ============================================================
 *  Discovery - manual IP entry first, mDNS as a bonus.
 *  Nothing here talks to port 80, so an ESPHome node without
 *  a `web_server:` is perfectly fine.
 * ============================================================ */

export function DiscoveryService() {
	this.IconUrl = ImageUrl();
	this.MDns = ["_esphomelib._tcp.local.", "_wled._tcp.local."];
	this.settingKey = "esphomeDevices";

	this.Initialize = function() {
		service.log("WLED UDP plugin ready - ESPHome `wled` effect supported");
		this.restoreDevices();
	};

	this.Update = function() {
		for (const entry of service.controllers) {
			if (entry !== undefined && entry.obj !== undefined && typeof entry.obj.update === "function") {
				entry.obj.update();
			}
		}
	};

	this.isValidIP = function(ipaddress) {
		return isIPv4(ipaddress);
	};

	/* Called from the UI: "Add device" */
	this.forceDiscover = function(ipaddress, port, ledCount, name) {
		const ip = String(ipaddress === undefined ? "" : ipaddress).trim();

		if (!isIPv4(ip)) {
			service.log("WLED UDP: '" + ipaddress + "' is not a valid IPv4 address");
			return;
		}

		const value = {
			"id": deviceId(ip),
			"mac": deviceId(ip),
			"name": hasValue(name) ? String(name) : defaultDeviceName(ip),
			"hostname": ip,
			"ip": ip,
			"udpPort": resolveUdpPort(port),
			"leds": resolveLedCount(ledCount),
			"forced": true,
		};

		service.log("WLED UDP: registering " + value.name + " -> " + ip + ":" + value.udpPort + " / " + value.leds + " LEDs");

		const existing = service.getController(value.id);

		if (existing === undefined || existing === null) {
			service.addController(new WLEDUdpBridge(value));
		} else if (existing.obj !== undefined) {
			existing.obj.updateWithValue(value);
			service.updateController(existing.obj);
		}

		this.saveDevices();
	};

	this.forceDelete = function(ipaddress) {
		for (const entry of service.controllers) {
			if (entry !== undefined && entry.obj !== undefined && entry.obj.ip === ipaddress) {
				service.log("WLED UDP: removing " + ipaddress);

				try {
					service.removeController(entry.obj);
				} catch (e) {
					service.removeController(entry);
				}

				break;
			}
		}

		this.saveDevices();
	};

	this.Discovered = function(value) {
		if (value === undefined || value === null) {
			return;
		}

		service.log("WLED UDP: mDNS answer " + JSON.stringify(value));

		const host = String(value.hostname === undefined ? "" : value.hostname).replace(/\.$/i, "");
		const ip = isIPv4(host) ? host : (isIPv4(value.ip) ? value.ip : "");

		if (ip.length === 0) {
			service.log("WLED UDP: skipping mDNS device without a usable IPv4 (add it by IP instead)");
			return;
		}

		const record = {
			"id": hasValue(value.mac) ? String(value.mac) : deviceId(ip),
			"mac": hasValue(value.mac) ? String(value.mac) : deviceId(ip),
			"name": hasValue(value.name) ? String(value.name) : defaultDeviceName(ip),
			"hostname": host,
			"ip": ip,
			"udpPort": resolveUdpPort(undefined),
			"leds": resolveLedCount(undefined),
			"forced": false,
		};

		const existing = service.getController(record.id);

		if (existing === undefined || existing === null) {
			service.addController(new WLEDUdpBridge(record));
		} else if (existing.obj !== undefined) {
			existing.obj.updateWithValue(record);
			service.updateController(existing.obj);
		}
	};

	/* ---- persistence of manually added devices ---- */

	this.saveDevices = function() {
		const list = {};

		for (const entry of service.controllers) {
			if (entry === undefined || entry.obj === undefined || !entry.obj.forced) {
				continue;
			}

			list[entry.obj.ip] = {
				"name": entry.obj.name,
				"port": entry.obj.udpPort,
				"leds": entry.obj.deviceledcount,
			};
		}

		service.saveSetting("esphome", this.settingKey, JSON.stringify(list));
	};

	this.restoreDevices = function() {
		const stored = service.getSetting("esphome", this.settingKey);

		if (!hasValue(stored)) {
			return;
		}

		let list;

		try {
			list = JSON.parse(stored);
		} catch (e) {
			service.log("WLED UDP: could not parse stored device list, starting fresh");
			return;
		}

		Object.keys(list).forEach((ip) => {
			const device = list[ip];
			service.log("WLED UDP: restoring " + ip);
			this.forceDiscover(ip, device.port, device.leds, device.name);
		});
	};
}

/* --------------------------- discovery record --------------------------- */

class WLEDUdpBridge {
	constructor(value) {
		this.load(value);
		this.readyToAnnounce = this.connected;
		this.announced = false;
		service.log("WLED UDP: constructed " + this.name + " (" + this.ip + ":" + this.udpPort + ")");
	}

	load(value) {
		this.id = hasValue(value.id) ? String(value.id) : String(value.ip);
		this.mac = hasValue(value.mac) ? String(value.mac) : this.id;
		const name = hasValue(value.name) ? String(value.name) : defaultDeviceName(value.ip);
		/* dots are not allowed in SignalRGB channel names */
		this.name = name.replace(/\./g, "-");
		this.hostname = hasValue(value.hostname) ? String(value.hostname) : String(value.ip);
		this.port = 80;
		this.ip = String(value.ip === undefined ? "" : value.ip);
		this.udpPort = resolveUdpPort(value.udpPort);
		this.deviceledcount = resolveLedCount(value.leds);
		this.forced = value.forced === true;

		/* Saved values always win: that is our "linked" state.
		 * Legacy builds keyed the settings by IP, so fall back to that. */
		const savedIp = firstValue(service.getSetting(this.id, "ip"), service.getSetting(this.ip, "ip"));
		this.connected = hasValue(savedIp);
		this.readyToAnnounce = this.connected;

		if (this.connected) {
			this.ip = String(savedIp);
		}

		const savedLeds = firstValue(service.getSetting(this.id, "leds"), service.getSetting(this.ip, "leds"));

		if (hasValue(savedLeds)) {
			this.deviceledcount = resolveLedCount(savedLeds);
		}

		const savedPort = firstValue(service.getSetting(this.id, "port"), service.getSetting(this.ip, "port"));

		if (hasValue(savedPort)) {
			this.udpPort = resolveUdpPort(savedPort);
		}
	}

	/* mDNS refresh - never overrides a user saved address. */
	updateWithValue(value) {
		this.name = hasValue(value.name) ? String(value.name) : this.name;
		this.forced = this.forced || value.forced === true;

		if (!this.connected && hasValue(value.ip)) {
			this.ip = String(value.ip);
		}

		service.updateController(this);
	}

	update() {
		this.createDevice();
	}

	createDevice() {
		if (!this.readyToAnnounce || this.announced) {
			return;
		}

		service.saveSetting(this.id, "name", this.name);
		service.saveSetting(this.id, "ip", this.ip);
		service.saveSetting(this.id, "leds", String(this.deviceledcount));
		service.saveSetting(this.id, "port", String(this.udpPort));
		service.updateController(this);
		service.announceController(this);
		this.announced = true;
		service.log("WLED UDP: announced " + this.name + " -> " + this.ip + ":" + this.udpPort + " / " + this.deviceledcount + " LEDs");
	}

	startLink() {
		this.connected = true;
		this.readyToAnnounce = true;
		this.announced = false;
		this.createDevice();
	}

	startRemove() {
		service.removeSetting(this.id, "name");
		service.removeSetting(this.id, "ip");
		service.removeSetting(this.id, "leds");
		service.removeSetting(this.id, "port");
		this.connected = false;
		this.readyToAnnounce = false;
		this.announced = false;
		service.suppressController(this);
		service.updateController(this);
	}

	startDelete() {
		discovery.forceDelete(this.ip);
	}

	/* Per device LED count, editable from the UI. */
	setLedCount(value) {
		const leds = resolveLedCount(value);

		if (leds === this.deviceledcount) {
			return;
		}

		this.deviceledcount = leds;
		service.saveSetting(this.id, "leds", String(leds));
		service.log("WLED UDP: " + this.name + " LED count set to " + leds);

		if (activeDevice !== undefined && activeDevice.id === this.id) {
			activeDevice.ledCount = leds;
		}

		if (this.connected) {
			try {
				device.removeChannel(this.name);
			} catch (e) {
				/* running instance may not expose removeChannel */
			}

			try {
				device.setLedLimit(leds);
				device.addChannel(this.name, leds);
			} catch (e) {
				service.log("WLED UDP: reload the plugin to apply the new LED count");
			}
		}

		service.updateController(this);
	}

	setUdpPort(value) {
		this.udpPort = resolveUdpPort(value);
		service.saveSetting(this.id, "port", String(this.udpPort));

		if (activeDevice !== undefined && activeDevice.id === this.id) {
			activeDevice.udpPort = this.udpPort;
		}

		service.updateController(this);
	}

	/* UI "Test" button - uses the plugin UDP stack, not the render loop. */
	testFrame() {
		sendTestFrame(this.ip, this.udpPort, this.deviceledcount);
	}

	turnOn() {
		if (activeDevice !== undefined && activeDevice.id === this.id) {
			activeDevice.turnOn();
		}
	}

	turnOff() {
		if (activeDevice !== undefined && activeDevice.id === this.id) {
			activeDevice.turnOff();
			return;
		}

		sendBlackout(this.ip, this.udpPort, this.deviceledcount);
	}
}
