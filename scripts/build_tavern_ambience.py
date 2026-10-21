#!/usr/bin/env python3
"""Reproduce nine quiet tavern mixes from four approved local CC0 assets.

Requires only Python's standard library and explicitly supplied FFmpeg with
libmp3lame. No network, synthetic voices, pitch changes or project dependencies.
Temporary PCM stays outside the repository. This performs technical asset QA,
not the application test suite.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import subprocess  # nosec B404
import sys
import tempfile
from array import array
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RATE, CHANNELS = 44_100, 2
NORMALIZE = 'loudnorm=I=-23:TP=-7:LRA=7'
CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/'
SOURCES = [
    {'file': 'tavern-room.mp3', 'author': 'domasmo', 'title': 'Pub in Cambridge',
     'page': 'https://freesound.org/people/domasmo/sounds/376456/',
     'preview': 'https://cdn.freesound.org/previews/376/376456_4339600-hq.mp3',
     'sha256': '3aac8d98b7f37c00a08645d6193e01d3203c63791c982499d45176274b06383b',
     'approved_processing': 'Original 0.750–120.750 s, 3 s tail/head crossfade; 117 s local room loop.'},
    {'file': 'glasses.mp3', 'author': 'EpicWizard', 'title': 'Drinking Glasses contact (Clink)',
     'page': 'https://freesound.org/people/EpicWizard/sounds/325195/',
     'preview': 'https://cdn.freesound.org/previews/325/325195_2291325-hq.mp3',
     'sha256': '9733bd5aaf1cac3e29df531033cc1b67f93990e12cc71e4c69c1694677da4d7a',
     'approved_processing': 'Original 2–10 s; 0.08 s entrance and 0.6 s exit fade.'},
    {'file': 'dishwasher.mp3', 'author': 'Caitlin_100', 'title': 'Emptying a dishwasher.mp3',
     'page': 'https://freesound.org/people/Caitlin_100/sounds/365551/',
     'preview': 'https://cdn.freesound.org/previews/365/365551_5407590-hq.mp3',
     'sha256': '2bbe62e430ec011c016abec7b132a8ee13bf31196ea6c0bccb82bbe6b9e94f42',
     'approved_processing': 'Original 3–16 s; 0.15 s entrance and 0.8 s exit fade.'},
    {'file': 'laughter.mp3', 'author': 'HowardV', 'title': 'live audience comedy show genuine laughter_moderate.wav',
     'page': 'https://freesound.org/people/HowardV/sounds/581528/',
     'preview': 'https://cdn.freesound.org/previews/581/581528_1654262-hq.mp3',
     'sha256': '3e750f23bfb80978dcfa691fb85610aa3cb802a446372c7ad588e1c118e756a2',
     'approved_processing': 'Original 3–11 s; 0.3 s entrance and 1.2 s exit fade.'},
]
# Each scene uses all four different 29.25 s blocks once, in a unique order.
# Detail gains are linear and deliberately well below the room source.
PROFILES = [
    (2, 'Nebenraum', [0, 2, 1, 3], 0, .10, 17, .84, 5200, [('glasses.mp3', 18, .10), ('dishwasher.mp3', 69, .065)]),
    (3, 'Fenstertisch', [2, 0, 3, 1], 7, .12, 29, 1.08, 5800, [('glasses.mp3', 37, .09), ('laughter.mp3', 84, .045)]),
    (4, 'Hintere Stube', [1, 3, 0, 2], 14, .15, 43, .78, 4800, [('dishwasher.mp3', 24, .055), ('glasses.mp3', 77, .11)]),
    (5, 'Gemuetliche Runde', [3, 1, 2, 0], 21, .10, 61, .95, 5500, [('laughter.mp3', 31, .04), ('glasses.mp3', 88, .095)]),
    (6, 'Tresenseite', [0, 3, 2, 1], 28, 0., 0, 1.12, 6000, [('glasses.mp3', 15, .12), ('dishwasher.mp3', 66, .07)]),
    (7, 'Ruhige Ecke', [2, 1, 0, 3], 35, .14, 37, .74, 4500, [('glasses.mp3', 46, .075), ('laughter.mp3', 91, .035)]),
    (8, 'Am Stammtisch', [1, 0, 3, 2], 42, .10, 53, 1.02, 5700, [('laughter.mp3', 20, .05), ('dishwasher.mp3', 73, .06)]),
    (9, 'Abendstube', [3, 2, 0, 1], 49, .13, 23, .88, 5000, [('dishwasher.mp3', 35, .05), ('glasses.mp3', 87, .085)]),
    (10, 'Tisch am Rand', [2, 3, 1, 0], 56, .11, 71, .98, 5400, [('glasses.mp3', 28, .105), ('laughter.mp3', 79, .04)]),
]


def run(command: list[str]) -> subprocess.CompletedProcess:
    # All callers construct an argument list for the explicit local FFmpeg
    # executable and hash-pinned inputs; there is no shell or remote input.
    result = subprocess.run(command, capture_output=True, check=False, timeout=180)  # nosec B603
    if result.returncode:
        raise RuntimeError(result.stderr.decode('utf-8', errors='replace'))
    return result


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def floats(data: bytes) -> array:
    samples = array('f')
    samples.frombytes(data)
    if sys.byteorder != 'little':
        samples.byteswap()
    return samples


def write_pcm(path: Path, samples: array) -> None:
    if sys.byteorder == 'little':
        path.write_bytes(samples.tobytes())
    else:
        copy = array('f', samples)
        copy.byteswap()
        path.write_bytes(copy.tobytes())


def decode(ffmpeg: str, path: Path) -> array:
    return floats(run([
        ffmpeg, '-hide_banner', '-nostdin', '-v', 'error', '-i', str(path),
        '-map', '0:a:0', '-f', 'f32le', '-ar', str(RATE), '-ac', str(CHANNELS), '-',
    ]).stdout)


def loudness(stderr: bytes) -> dict:
    matches = re.findall(rb'\{\s*"input_i".*?\}', stderr, flags=re.DOTALL)
    if not matches:
        raise RuntimeError('FFmpeg did not return loudness measurements')
    return json.loads(matches[-1])


def dbfs(value: float) -> float:
    return 20 * math.log10(max(value, 1e-12))


def join(left: array, right: array, seconds: int) -> array:
    count = seconds * RATE
    overlap = count * CHANNELS
    result = array('f', left[:-overlap])
    for frame in range(count):
        weight = frame / (count - 1)
        for channel in range(CHANNELS):
            index = frame * CHANNELS + channel
            result.append(left[-overlap + index] * (1 - weight) + right[index] * weight)
    result.extend(right[overlap:])
    return result


def loop_join(samples: array) -> array:
    count = 3 * RATE
    overlap = count * CHANNELS
    result = array('f', samples[overlap:-overlap])
    for frame in range(count):
        weight = frame / (count - 1)
        for channel in range(CHANNELS):
            index = frame * CHANNELS + channel
            result.append(samples[-overlap + index] * (1 - weight) + samples[index] * weight)
    return result


def compose(room: array, details: dict, profile: tuple) -> array:
    _, _, order, offset, layer_gain, layer_offset, width, _, events = profile
    shift = offset * RATE * CHANNELS
    rotated = room[shift:] + room[:shift]
    block_samples = len(rotated) // 4
    blocks = [rotated[i * block_samples:(i + 1) * block_samples] for i in range(4)]
    arranged = array('f', blocks[order[0]])
    for number in order[1:]:
        arranged = join(arranged, blocks[number], 2)
    mixed = array('f', arranged)
    second_shift = layer_offset * RATE * CHANNELS
    for frame in range(len(mixed) // CHANNELS):
        index = frame * CHANNELS
        second = (index + second_shift) % len(arranged)
        left = (arranged[index] + arranged[second] * layer_gain) / (1 + layer_gain)
        right = (arranged[index + 1] + arranged[second + 1] * layer_gain) / (1 + layer_gain)
        middle = (left + right) / 2
        side = (left - right) * width / 2
        mixed[index], mixed[index + 1] = middle + side, middle - side
    for name, when, gain in events:
        detail = details[name]
        start = when * RATE * CHANNELS
        if start < 3 * RATE * CHANNELS or start + len(detail) >= len(mixed) - 3 * RATE * CHANNELS:
            raise ValueError('A detail would overlap the final loop crossfade')
        for index, sample in enumerate(detail):
            mixed[start + index] += sample * gain
    return mixed


def normalize(ffmpeg: str, raw: Path, lowpass: int, output_raw: Path) -> dict:
    filters = f'highpass=f=100,lowpass=f={lowpass}'
    base = [ffmpeg, '-hide_banner', '-nostdin', '-threads', '1', '-f', 'f32le',
            '-ar', str(RATE), '-ac', str(CHANNELS), '-i', str(raw)]
    measured = loudness(run(base + ['-af', f'{filters},{NORMALIZE}:print_format=json', '-f', 'null', '-']).stderr)
    linear = (
        f"{NORMALIZE}:linear=true:measured_I={measured['input_i']}"
        f":measured_TP={measured['input_tp']}:measured_LRA={measured['input_lra']}"
        f":measured_thresh={measured['input_thresh']}:offset={measured['target_offset']}"
    )
    run(base + ['-y', '-af', f'{filters},{linear},alimiter=limit=0.45:level=false,aresample={RATE}',
                '-f', 'f32le', str(output_raw)])
    return measured


def encode(ffmpeg: str, raw: Path, output: Path) -> None:
    run([ffmpeg, '-hide_banner', '-nostdin', '-y', '-threads', '1', '-f', 'f32le',
         '-ar', str(RATE), '-ac', str(CHANNELS), '-i', str(raw), '-map_metadata', '-1',
         '-c:a', 'libmp3lame', '-b:a', '96k', '-ar', str(RATE), '-ac', str(CHANNELS),
         '-id3v2_version', '3', '-write_xing', '1', str(output)])


def build(ffmpeg: str, room: array, details: dict, profile: tuple, output_dir: Path, temporary: Path) -> dict:
    number, name, order, offset, layer_gain, layer_offset, width, lowpass, events = profile
    raw, normalized = temporary / 'mix.f32le', temporary / 'normalized.f32le'
    write_pcm(raw, compose(room, details, profile))
    measured = normalize(ffmpeg, raw, lowpass, normalized)
    samples = loop_join(floats(normalized.read_bytes()))
    write_pcm(raw, samples)
    output = output_dir / f'tavern-room-{number:02d}.mp3'
    encode(ffmpeg, raw, output)
    decoded = decode(ffmpeg, output)
    peak = max(abs(sample) for sample in decoded)
    gain_db = min(0., -7.2 - dbfs(peak))
    if gain_db < 0:
        gain = 10 ** (gain_db / 20)
        samples = array('f', (sample * gain for sample in samples))
        write_pcm(raw, samples)
        encode(ffmpeg, raw, output)
        decoded = decode(ffmpeg, output)
        peak = max(abs(sample) for sample in decoded)
    frames = len(decoded) // CHANNELS
    if frames != 108 * RATE or dbfs(peak) > -7:
        raise ValueError(f'Incorrect duration or excessive peak: {output.name}')
    detail_bytes = sum((output_dir / filename).stat().st_size for filename in details)
    if output.stat().st_size + detail_bytes >= 1_800_000:
        raise ValueError(f'Room plus details exceed 1.8 MB: {output.name}')
    levels = loudness(run([ffmpeg, '-hide_banner', '-nostdin', '-i', str(output),
                          '-af', f'{NORMALIZE}:print_format=json', '-f', 'null', '-']).stderr)
    boundary = max(abs(decoded[-CHANNELS + channel] - decoded[channel]) for channel in range(CHANNELS))
    pcm_boundary = max(abs(samples[-CHANNELS + channel] - samples[channel]) for channel in range(CHANNELS))
    largest_step = max(abs(decoded[index] - decoded[index - CHANNELS]) for index in range(CHANNELS, len(decoded)))
    result = {
        'file': str(output.relative_to(ROOT)), 'composition_name': name,
        'composition': {
            'room_rotation_seconds': offset, 'quarter_block_order_zero_based': order,
            'quarter_block_duration_seconds': 29.25, 'internal_crossfade_seconds': 2,
            'secondary_room_layer_gain': layer_gain, 'secondary_room_layer_offset_seconds': layer_offset,
            'stereo_width': width, 'highpass_hz': 100, 'lowpass_hz': lowpass,
            'sparse_details': [{'source': event[0], 'start_before_final_loop_join_seconds': event[1],
                                'linear_gain': event[2]} for event in events],
        },
        'duration_seconds': frames / RATE, 'sample_rate_hz': RATE, 'channels': CHANNELS,
        'mp3_bitrate_kbps': 96, 'size_bytes': output.stat().st_size,
        'room_plus_details_bytes': output.stat().st_size + detail_bytes, 'sha256': sha256(output),
        'decode': 'complete, without decoder errors', 'decoded_frames_per_channel': frames,
        'decoded_sample_peak_dbfs': round(dbfs(peak), 3),
        'decoded_integrated_loudness_lufs': float(levels['input_i']),
        'decoded_true_peak_dbtp': float(levels['input_tp']),
        'decoded_loudness_range_lu': float(levels['input_lra']),
        'post_encode_safety_gain_db': round(gain_db, 4), 'normalization_input_measurement': measured,
        'loop_seam': {
            'pcm_boundary_step_dbfs': round(dbfs(pcm_boundary), 3),
            'decoded_boundary_step_dbfs': round(dbfs(boundary), 3),
            'largest_internal_sample_step_dbfs': round(dbfs(largest_step), 3),
            'boundary_step_below_largest_internal_step': boundary <= largest_step,
        },
    }
    print(f"{output.name}: 108 s; {result['size_bytes']} bytes; {result['decoded_integrated_loudness_lufs']} LUFS; peak {result['decoded_sample_peak_dbfs']} dBFS", flush=True)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg', required=True, help='Path to FFmpeg with libmp3lame')
    parser.add_argument('--source-dir', type=Path, default=ROOT / 'app/static/audio/hausdepp',
                        help='Directory containing the four approved, hash-pinned local assets')
    arguments = parser.parse_args()
    executable = Path(arguments.ffmpeg).expanduser().resolve(strict=True)
    if not executable.is_file():
        parser.error('--ffmpeg must name a local executable file')
    arguments.ffmpeg = str(executable)
    source_dir = arguments.source_dir.expanduser().resolve()
    output_dir = ROOT / 'app/static/audio/hausdepp'
    for source in SOURCES:
        if sha256(source_dir / source['file']) != source['sha256']:
            raise ValueError(f"Approved source hash differs: {source['file']}")
    decoded_sources = {source['file']: decode(arguments.ffmpeg, source_dir / source['file']) for source in SOURCES}
    room = decoded_sources.pop('tavern-room.mp3')
    if len(room) != 117 * RATE * CHANNELS:
        raise ValueError('Approved source must decode to exactly 117 seconds')
    with tempfile.TemporaryDirectory(prefix='rollthedice-ambience-') as temporary:
        variants = [build(arguments.ffmpeg, room, decoded_sources, profile, output_dir, Path(temporary)) for profile in PROFILES]
    for source in SOURCES:
        if sha256(output_dir / source['file']) != source['sha256']:
            raise ValueError(f"Original asset unexpectedly changed: {source['file']}")
    if len({variant['sha256'] for variant in variants}) != 9:
        raise ValueError('The nine new mixes must have distinct hashes')
    manifest = {
        'schema_version': 1,
        'purpose': 'Nine different mixes of four previously approved real CC0 room/object recordings, alongside the unchanged original room loop.',
        'source_scope': 'These are nine new compositions, not recordings of nine additional pubs.',
        'generator': 'scripts/build_tavern_ambience.py',
        'ffmpeg_version': run([arguments.ffmpeg, '-version']).stdout.decode().splitlines()[0],
        'reproduction': 'python3 scripts/build_tavern_ambience.py --ffmpeg /absolute/path/to/ffmpeg',
        'sources': [{**source, 'license': 'CC0 1.0 Universal', 'license_url': CC0,
                     'license_documented_on': '2026-10-20', 'license_evidence': 'docs/HAUSDEPP_AUDIO_ASSETS.md'} for source in SOURCES],
        'treatment': {
            'arrangement': 'Rotate the original 117-second room; reorder four 29.25-second blocks, each used once; join with three 2-second linear crossfades.',
            'normalization': 'Two-pass loudnorm I=-23 LUFS, TP=-7 dBTP, LRA=7; linear when supported by source measurements.',
            'limiter': 'alimiter=limit=0.45:level=false (no automatic makeup gain)',
            'loop': '3-second linear tail/head crossfade: body[3:D-3], then tail[D-3:D] mixed with head[0:3]; 111-second arrangement becomes 108-second loop.',
            'encoding': '44.1 kHz stereo, libmp3lame 96 kbit/s; metadata stripped, gapless Xing header retained.',
            'safety': 'Additional constant attenuation only when needed to keep encoded sample peaks at or below -7.2 dBFS.',
        },
        'content_review': {
            'assets': 'Previously approved actual room/object recordings; no synthetic voices, music or pitch changes added.',
            'audition': 'No subjective listening review recorded for the new mixes.',
            'technical_qa': 'All nine fully decoded; duration, byte budget, loudness, sample peaks, true peaks and loop-boundary sample steps measured.',
        },
        'new_room_assets_total_bytes': sum(variant['size_bytes'] for variant in variants),
        'variants': variants,
    }
    manifest_path = ROOT / 'docs/references/hausdepp-ambience-variants.json'
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Provenance written: {manifest_path.relative_to(ROOT)}', flush=True)


if __name__ == '__main__':
    main()
