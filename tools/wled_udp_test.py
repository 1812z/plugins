#!/usr/bin/env python3
"""Standalone WLED UDP (DNRGB) test sender.

Sends exactly the same packets as the SignalRGB plugin, so it isolates
"ESPHome side" from "SignalRGB side".

    python tools/wled_udp_test.py --ip 192.168.44.172 --leds 144
    python tools/wled_udp_test.py --ip 192.168.44.172 --leds 144 --mode chase --seconds 10
"""

import argparse
import colorsys
import socket
import time

PROTOCOL_DNRGB = 0x04
TIMEOUT = 2
MAX_LEDS_PER_PACKET = 485


def packets(colors, led_count):
    """Yield DNRGB packets: [0x04, timeout, startHi, startLo, R,G,B ...]."""
    total = min(led_count, len(colors))
    offset = 0
    while offset < total:
        count = min(MAX_LEDS_PER_PACKET, total - offset)
        header = bytes([PROTOCOL_DNRGB, TIMEOUT, (offset >> 8) & 0xFF, offset & 0xFF])
        body = bytearray()
        for r, g, b in colors[offset:offset + count]:
            body += bytes((r, g, b))
        yield header + bytes(body)
        offset += count


def rainbow(led_count, t):
    out = []
    for i in range(led_count):
        h = ((i / max(1, led_count)) + t) % 1.0
        r, g, b = colorsys.hsv_to_rgb(h, 1.0, 1.0)
        out.append((int(r * 255), int(g * 255), int(b * 255)))
    return out


def solid(led_count, rgb):
    return [rgb] * led_count


def chase(led_count, t):
    pos = int(t * 20) % max(1, led_count)
    out = []
    for i in range(led_count):
        dist = min((i - pos) % led_count, (pos - i) % led_count)
        v = max(0, 255 - dist * 24)
        out.append((v, 0, 255 - v))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ip", required=True)
    ap.add_argument("--port", type=int, default=21324)
    ap.add_argument("--leds", type=int, default=60)
    ap.add_argument("--seconds", type=float, default=8.0)
    ap.add_argument("--fps", type=float, default=40.0)
    ap.add_argument("--mode", choices=["rainbow", "red", "green", "blue", "white", "chase"], default="rainbow")
    args = ap.parse_args()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    start = time.time()
    frames = 0
    sent_packets = 0
    first_len = 0

    while time.time() - start < args.seconds:
        t = (time.time() - start) * 0.25
        if args.mode == "rainbow":
            colors = rainbow(args.leds, t)
        elif args.mode == "chase":
            colors = chase(args.leds, t)
        elif args.mode == "red":
            colors = solid(args.leds, (255, 0, 0))
        elif args.mode == "green":
            colors = solid(args.leds, (0, 255, 0))
        elif args.mode == "blue":
            colors = solid(args.leds, (0, 0, 255))
        else:
            colors = solid(args.leds, (255, 255, 255))

        for packet in packets(colors, args.leds):
            sock.sendto(packet, (args.ip, args.port))
            sent_packets += 1
            first_len = first_len or len(packet)

        frames += 1
        time.sleep(1.0 / args.fps)

    sock.close()
    print(f"sent {frames} frames / {sent_packets} packets -> {args.ip}:{args.port} "
          f"({args.leds} LEDs, mode={args.mode}, first packet {first_len} bytes)")


if __name__ == "__main__":
    main()
