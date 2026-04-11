export function pcmStereoToMono(pcmStereo: Buffer): Buffer {
  // Input: signed 16-bit LE stereo PCM interleaved (L,R)
  if (pcmStereo.length < 4) return Buffer.alloc(0);
  const sampleCount = Math.floor(pcmStereo.length / 2);
  const frameCount = Math.floor(sampleCount / 2);
  const out = Buffer.allocUnsafe(frameCount * 2);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const i = frame * 4;
    const l = pcmStereo.readInt16LE(i);
    const r = pcmStereo.readInt16LE(i + 2);
    const mixed = Math.max(-32768, Math.min(32767, Math.round((l + r) / 2)));
    out.writeInt16LE(mixed, frame * 2);
  }

  return out;
}

export function buildWavPcm16(params: { pcm: Buffer; channels: number; sampleRate: number }): Buffer {
  const { pcm, channels, sampleRate } = params;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcm.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

export function estimateDurationMsFromPcm(params: { pcmBytes: number; channels: number; sampleRate: number }): number {
  const bytesPerFrame = params.channels * 2;
  if (bytesPerFrame <= 0 || params.sampleRate <= 0) return 0;
  const frames = Math.floor(params.pcmBytes / bytesPerFrame);
  return Math.round((frames / params.sampleRate) * 1000);
}

