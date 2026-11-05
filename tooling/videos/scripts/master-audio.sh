#!/bin/bash
# Masters a rendered film's soundtrack for delivery, and muxes it back with
# the picture untouched.
#
#   scripts/master-audio.sh <in.mp4> <out.mp4> <room-tone-start-seconds>
#
# The take is recorded raw (no gain riding, no noise gate), so the room comes
# with it. The chain, measured on the EIC take of 2026-11-04 (voice 21 dB over
# the room before, 28 after; -17.9 LUFS with clipped peaks before, -16 LUFS
# at -1.3 dBTP after):
#
#   1. high-pass at 80 Hz: rumble under the voices
#   2. FFT denoise with a noise profile learned from one second of room tone
#      (give a pause with nobody speaking); a profile it tracks by itself did
#      nothing on that room
#   3. a soft expander: the room down by up to 12 dB between phrases
#   4. -2 dB at 300 Hz (boxiness), +2 dB at 3.5 kHz (presence)
#   5. a fixed gain to -16 LUFS and a limiter at -2 dBFS. No compressor, and
#      no dynamic loudnorm: both lift the room between phrases back up
#   6. the denoiser and the limiter delay the sound by 1272 samples (26.5 ms);
#      the end trims that off, so the sound stays on the lips
set -euo pipefail
IN=$1; OUT=$2; NOISE=$3
FF=${FFMPEG:-ffmpeg}
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

"$FF" -v error -y -i "$IN" -vn -c:a pcm_s16le "$TMP/a.wav"
"$FF" -v error -y -i "$TMP/a.wav" -filter_complex \
  "[0:a]atrim=$NOISE:$(echo "$NOISE + 1" | bc),asetpts=PTS-STARTPTS[n];[0:a]asetpts=PTS-STARTPTS[f];[n][f]concat=n=2:v=0:a=1,highpass=f=80:p=2,highpass=f=80:p=2,asendcmd=c='0.05 afftdn sn start; 0.95 afftdn sn stop',afftdn=nr=12:nf=-50,atrim=start=1.0,asetpts=PTS-STARTPTS[o]" \
  -map "[o]" -c:a pcm_s16le "$TMP/dn.wav"
PRE="agate=threshold=0.02:ratio=2.5:range=0.25:attack=4:release=220:knee=4:detection=rms,equalizer=f=300:t=q:w=1.2:g=-2,equalizer=f=3500:t=q:w=1.0:g=2"
I=$("$FF" -hide_banner -nostats -i "$TMP/dn.wav" -af "$PRE,ebur128" -f null - 2>&1 | grep -A3 "Integrated loudness" | grep "I:" | awk '{print $2}')
G=$(echo "-16 - ($I) + 0.3" | bc)
"$FF" -v error -y -i "$TMP/dn.wav" -af "$PRE,volume=${G}dB,alimiter=limit=0.79:attack=2:release=50:level=disabled,aresample=48000,atrim=start_sample=1272,asetpts=PTS-STARTPTS,apad=pad_len=1272" -c:a pcm_s16le "$TMP/m.wav"
"$FF" -v error -y -i "$IN" -i "$TMP/m.wav" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 256k -ar 48000 -shortest -movflags +faststart "$OUT"
"$FF" -hide_banner -nostats -i "$OUT" -vn -af ebur128=peak=true -f null - 2>&1 | grep -A14 "Summary" | grep -E "I:|Peak:"
