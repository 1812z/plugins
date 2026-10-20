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
- **Send test frame** — pushes a rainbow straight through the plugin's UDP stack,
  bypassing the render loop. If the strip lights up here but not with an effect,
  the problem is on the SignalRGB side, not the network. The frame uses timeout
  `255` (never blanks), so the strip stays lit until the next frame arrives.
- **Link / Unlink** — attach or detach the device from the SignalRGB canvas.
- **×** — remove a manually added device.

## Troubleshooting

Check the SignalRGB log for these three lines — they mean the render instance is alive:

```
WLED UDP: Initialize() for ...
WLED UDP driving ... at 192.168.44.172:21324 (144 LEDs)
WLED UDP: first frame sent -> 192.168.44.172:21324 (144 LEDs)
```

- only `announced ...` appears → the device is registered but the render instance never
  started: click **Unlink** then **Link**, or delete and re-add the device.
- `no channel named ...` → the LED count changed while running; reload the plugin.
- nothing lights but the log shows frames → check the ESPHome side: light must be on,
  `WLED` effect selected, `num_leds` matches, and the ESPHome log must not contain
  `Cannot bind WLEDLightEffect to 21324`.

`tools/wled_udp_test.py` sends the exact same packets without SignalRGB, which is the
fastest way to prove the ESPHome side works:

```bash
python tools/wled_udp_test.py --ip 192.168.44.172 --leds 144 --mode rainbow --seconds 15
```

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
