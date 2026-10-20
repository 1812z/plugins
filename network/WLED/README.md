# WLED UDP — SignalRGB plugin (ESPHome compatible)

Minimal UDP-only WLED plugin. No HTTP, no port 80, no `/json` API, no `web_server:` requirement.
It works with both real WLED firmware and ESPHome's built-in `wled` light effect.

## How it talks to the device

Realtime packet, WLED protocol `DNRGB` (0x04):

```
[0x04, timeout, startHi, startLo, R, G, B, R, G, B, ...]
```

This is parsed by ESPHome in `esphome/components/wled/wled_light_effect.cpp`
(`parse_dnrgb_frame_`) and by WLED firmware in `wled00/udp.cpp`, so one packet format drives both.
Frames are split into 485-LED chunks (1459 bytes) to stay under the UDP payload limit.

## ESPHome configuration

The `wled` effect must be selected on the light, and the light must be **on**.

```yaml
light:
  - platform: esp32_rmt_led_strip        # or esp8266_pwm/pwm etc.
    id: strip
    pin: GPIO16
    num_leds: 60
    rgb_order: GRB
    chipset: WS2812
    name: "Desk Strip"
    effects:
      - wled:
          port: 21324                    # optional, default 21324
          # blank_on_start: true
```

Notes:

- `num_leds` must match the LED count you enter in the plugin.
- Select the `WLED` effect in Home Assistant / web UI. SignalRGB cannot switch the
  effect for you (that would need the HTTP API).
- After ~2 s without packets ESPHome blanks the strip, so stopping SignalRGB behaves
  like a normal stop.

## Install

Copy the `network/WLED` folder into:

```
%userprofile%\Documents\WhirlwindFX\Plugins\WLED\
```

Restart SignalRGB. Open the plugin page → enter `IP`, `UDP port`, `LED count` → **Add**,
then click **Link** on the device card.

## UI

- **Add by IP** — registers the device; nothing is probed on port 80, so it works even
  when the ESPHome node has no web server.
- **LED count** — editable per device; ESPHome cannot report it over UDP.
- **On / Off** — Off streams black frames (there is no state API to call).
- **Link / Unlink** — attach or detach the device from the SignalRGB canvas.
- **×** — remove a manually added device.

## ESPHome vs WLED protocol byte numbering

ESPHome's enum adds `WLED_NOTIFIER = 0`, so:

| protocol | ESPHome | WLED firmware |
| -------- | ------- | ------------- |
| WARLS    | 1       | 1             |
| DRGB     | 2       | 2             |
| DRGBW    | 3       | 3             |
| DNRGB    | 4       | 4             |

`DNRGB` (0x04) is used here because it carries a 16-bit start index, which allows
frames longer than one packet.
