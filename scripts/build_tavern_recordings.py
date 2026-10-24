#!/usr/bin/env python3
"""Build additional real tavern beds from locally downloaded, hash-pinned CC0 sources.

No network access or new Python dependencies. Use --source-dir for the source
files listed in docs/references/tavern-recordings.json and an explicit FFmpeg.
Audio measurements verify encoding and levels, not subjective listening.
"""
from __future__ import annotations

import argparse
import json
import tempfile
from array import array
from pathlib import Path

from build_tavern_ambience import (
    CHANNELS,
    NORMALIZE,
    RATE,
    ROOT,
    dbfs,
    decode,
    encode,
    floats,
    loop_join,
    loudness,
    normalize,
    run,
    sha256,
    write_pcm,
)

MANIFEST = ROOT / 'docs/references/tavern-recordings.json'


def build(ffmpeg: str, source_dir: Path, source: dict, temporary: Path) -> dict:
    original = source_dir / source['download_file']
    if sha256(original) != source['download_sha256']:
        raise ValueError(f"Source hash differs: {original.name}")
    decoded = decode(ffmpeg, original)
    start = round(source['start_seconds'] * RATE) * CHANNELS
    length = round(source['excerpt_seconds'] * RATE) * CHANNELS
    if start < 0 or length < 60 * RATE * CHANNELS or start + length > len(decoded):
        raise ValueError(f"Source does not cover its declared excerpt: {original.name}")
    excerpt = decoded[start:start + length]
    if 'source_channel' in source:
        channel = source['source_channel']
        if channel not in (0, 1):
            raise ValueError('source_channel must be 0 or 1')
        # Some field recordings are mono in a stereo container. Preserve the
        # healthy microphone channel equally in both output speakers.
        mono = excerpt[channel::CHANNELS]
        excerpt = array('f', (sample for value in mono for sample in (value, value)))
    raw, normalized = temporary / 'room.f32le', temporary / 'normalized.f32le'
    write_pcm(raw, excerpt)
    normalize(ffmpeg, raw, 6000, normalized)
    # Join after the stateful filters: their initial conditions must not
    # reintroduce a transient at an otherwise continuous loop boundary.
    samples = loop_join(floats(normalized.read_bytes()))
    write_pcm(normalized, samples)
    output = ROOT / source['file']
    output.parent.mkdir(parents=True, exist_ok=True)
    encode(ffmpeg, normalized, output)
    decoded = decode(ffmpeg, output)
    peak = max(abs(sample) for sample in decoded)
    attenuation = min(0., -7.2 - dbfs(peak))
    if attenuation < 0:
        gain = 10 ** (attenuation / 20)
        write_pcm(normalized, array('f', (sample * gain for sample in samples)))
        encode(ffmpeg, normalized, output)
        decoded = decode(ffmpeg, output)
        peak = max(abs(sample) for sample in decoded)
    frames = len(decoded) // CHANNELS
    if frames != length // CHANNELS - 3 * RATE or dbfs(peak) > -7:
        raise ValueError(f'Incorrect decoded duration or excessive peak: {output.name}')
    if output.stat().st_size >= 1_850_000:
        raise ValueError(f'Room exceeds the lazy-download byte budget: {output.name}')
    levels = loudness(run([ffmpeg, '-hide_banner', '-nostdin', '-i', str(output),
                          '-af', f'{NORMALIZE}:print_format=json', '-f', 'null', '-']).stderr)
    if not -24.5 <= float(levels['input_i']) <= -22.5 or float(levels['input_tp']) > -7:
        raise ValueError(f'Room loudness or true peak exceeds the intended range: {output.name}')
    boundary = max(abs(decoded[-CHANNELS + c] - decoded[c]) for c in range(CHANNELS))
    largest = max(abs(decoded[i] - decoded[i - CHANNELS]) for i in range(CHANNELS, len(decoded)))
    if boundary > largest:
        raise ValueError(f'Loop seam exceeds internal sample steps: {output.name}')
    result = {
        'file': source['file'], 'sha256': sha256(output),
        'size_bytes': output.stat().st_size, 'duration_seconds': frames / RATE,
        'decoded_frames_per_channel': frames, 'sample_rate_hz': RATE,
        'channels': CHANNELS, 'mp3_bitrate_kbps': 96,
        'decoded_sample_peak_dbfs': round(dbfs(peak), 3),
        'decoded_integrated_loudness_lufs': float(levels['input_i']),
        'decoded_true_peak_dbtp': float(levels['input_tp']),
        'decoded_loudness_range_lu': float(levels['input_lra']),
        'post_encode_attenuation_db': round(attenuation, 4),
        'decoded_loop_boundary_step_dbfs': round(dbfs(boundary), 3),
        'largest_internal_sample_step_dbfs': round(dbfs(largest), 3),
        'complete_decode': True,
    }
    print(f"{output.name}: {frames / RATE:g}s; {result['size_bytes']} bytes; "
          f"{result['decoded_integrated_loudness_lufs']} LUFS; peak {result['decoded_sample_peak_dbfs']} dBFS", flush=True)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg', required=True)
    parser.add_argument('--source-dir', required=True, type=Path)
    args = parser.parse_args()
    executable = Path(args.ffmpeg).expanduser().resolve(strict=True)
    if not executable.is_file():
        parser.error('--ffmpeg must name a local executable')
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    with tempfile.TemporaryDirectory(prefix='rollthedice-real-rooms-') as folder:
        manifest['assets'] = [build(str(executable), args.source_dir, source, Path(folder))
                              for source in manifest['sources']]
    manifest['ffmpeg_version'] = run([str(executable), '-version']).stdout.decode().splitlines()[0]
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
