#!/bin/bash
# Lays the EIC film's music bed (scripts/compose-eic-bed.mjs) under a
# mastered film (scripts/master-audio.sh), picture copied untouched.
#
#   scripts/mix-bed.sh <mastered.mp4> <out.mp4> [gain-dB]
#
# The bed is high-passed at 170 Hz and dipped at 2.5 kHz so it never sits on
# the voices, ducked by them (a sidechain: ~5 dB more while anyone speaks),
# and lifted on the end card. At the default -5.5 dB it ran 18 dB under the
# voices on the take of 2026-11-04, and -28.6 dB on the end card. The voices
# are not processed, so they stay on the lips.
set -euo pipefail
IN=$1; OUT=$2; G=${3:--5.5}
FF=${FFMPEG:-ffmpeg}
BEDWAV="$(dirname "$0")/../public/eic/bed.wav"
D=$("$FF" -hide_banner -i "$IN" -map 0:a -f null - 2>&1 | grep -o "time=[0-9:.]*" | tail -1 | awk -F'[=:]' '{print $2*3600+$3*60+$4}')
LIFT=$(echo "$D - 3.2" | bc)
FADE=$(echo "$D - 2.5" | bc)
"$FF" -v error -y -i "$IN" -i "$BEDWAV" -filter_complex "\
[0:a]asplit=2[voice][key];\
[1:a]atrim=0:$D,asetpts=PTS-STARTPTS,highpass=f=170:p=2,highpass=f=170:p=2,equalizer=f=2500:t=q:w=1.5:g=-4,volume=${G}dB,volume='1+min(max(t-$LIFT,0)/1.2,1)':eval=frame,afade=t=in:d=2,afade=t=out:st=$FADE:d=2.5[bed];\
[bed][key]sidechaincompress=threshold=0.05:ratio=4:attack=30:release=700:knee=6:makeup=1[ducked];\
[voice][ducked]amix=inputs=2:normalize=0:duration=first[mix]" \
  -map 0:v -map "[mix]" -c:v copy -c:a aac -b:a 256k -ar 48000 -movflags +faststart "$OUT"
"$FF" -hide_banner -nostats -i "$OUT" -vn -af ebur128=peak=true -f null - 2>&1 | grep -A14 "Summary" | grep -E "I:|Peak:"
