# SignalRGB — WLED UDP (ESPHome compatible)

[![Add to SignalRGB](https://raw.githubusercontent.com/SRGBmods/QMK-Images/main/images/add-to-signalrgb.png)](https://srgbmods.net/s?p=addon/install?url=https://github.com/1812z/plugins)

Minimal UDP-only WLED addon for SignalRGB. It drives real WLED firmware **and** ESPHome's built-in
`wled` light effect — no HTTP, no port 80, no `/json` API, no `web_server:` required.

- Realtime `DNRGB` (0x04) packets on UDP `21324`
- Frames split into 485-LED chunks, 16-bit start index, up to 2000 LEDs
- Devices added by IP, with per-device LED count and UDP port
- Multiple strips via SignalRGB subdevices

## Install

Click the button above and accept the SignalRGB prompt, or copy the `network/WLED` folder into:

```
%userprofile%\Documents\WhirlwindFX\Plugins\WLED\
```

Then open the addon page, enter `IP` / `UDP port` / `LED count`, click **Add**, then **Link**.

## ESPHome config

The light must be **on** and the `WLED` effect **selected** — SignalRGB cannot switch the effect
over UDP.

```yaml
light:
  - platform: esp32_rmt_led_strip
    id: strip
    pin: GPIO16
    num_leds: 60
    rgb_order: GRB
    chipset: WS2812
    name: "Desk Strip"
    effects:
      - wled:
          port: 21324
```

## Docs

Protocol details, UI reference and troubleshooting: [`network/WLED/README.md`](network/WLED/README.md)
