import type { ShadeContext } from '../gen/texture';
import { shadeColor } from '../gen/texture';
import { sampleHeightElmo } from '../gen/dims';

const MINIMAP_SIZE = 1024;
const MIN_MIP_SIZE = 4;

export function encodeSmfMinimap(ctx: ShadeContext): Uint8Array {
  let size = MINIMAP_SIZE;
  let pixels = renderLevel(ctx, size);
  const levels: Uint8Array[] = [];
  while (size >= MIN_MIP_SIZE) {
    levels.push(encodeDxt1(pixels, size, size));
    if (size === MIN_MIP_SIZE) break;
    pixels = downsample(pixels, size, size);
    size /= 2;
  }
  const total = levels.reduce((sum, level) => sum + level.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const level of levels) {
    output.set(level, offset);
    offset += level.length;
  }
  return output;
}

function renderLevel(ctx: ShadeContext, size: number): Uint8Array {
  const pixels = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    const ez = ((y + 0.5) / size) * ctx.dims.worldElmos;
    for (let x = 0; x < size; x++) {
      const ex = ((x + 0.5) / size) * ctx.dims.worldElmos;
      const height = sampleHeightElmo(ctx.height, ctx.dims, ex, ez);
      const color = shadeColor(ctx, ex, ez, height);
      const index = (y * size + x) * 3;
      pixels[index] = color.r;
      pixels[index + 1] = color.g;
      pixels[index + 2] = color.b;
    }
  }
  return pixels;
}

function downsample(source: Uint8Array, width: number, height: number): Uint8Array {
  const nextWidth = width / 2;
  const nextHeight = height / 2;
  const output = new Uint8Array(nextWidth * nextHeight * 3);
  for (let y = 0; y < nextHeight; y++) {
    for (let x = 0; x < nextWidth; x++) {
      const outputIndex = (y * nextWidth + x) * 3;
      for (let channel = 0; channel < 3; channel++) {
        const a = source[((y * 2) * width + x * 2) * 3 + channel];
        const b = source[((y * 2) * width + x * 2 + 1) * 3 + channel];
        const c = source[(((y * 2) + 1) * width + x * 2) * 3 + channel];
        const d = source[(((y * 2) + 1) * width + x * 2 + 1) * 3 + channel];
        output[outputIndex + channel] = Math.round((a + b + c + d) / 4);
      }
    }
  }
  return output;
}

function encodeDxt1(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const blocksWide = Math.ceil(width / 4);
  const blocksHigh = Math.ceil(height / 4);
  const output = new Uint8Array(blocksWide * blocksHigh * 8);
  let outputOffset = 0;
  for (let blockY = 0; blockY < blocksHigh; blockY++) {
    for (let blockX = 0; blockX < blocksWide; blockX++) {
      const colors: Array<[number, number, number]> = [];
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const px = Math.min(width - 1, blockX * 4 + x);
          const py = Math.min(height - 1, blockY * 4 + y);
          const index = (py * width + px) * 3;
          colors.push([pixels[index], pixels[index + 1], pixels[index + 2]]);
        }
      }
      let darkest = colors[0];
      let lightest = colors[0];
      for (const color of colors) {
        if (luminance(color) < luminance(darkest)) darkest = color;
        if (luminance(color) > luminance(lightest)) lightest = color;
      }
      let color0 = toRgb565(lightest);
      let color1 = toRgb565(darkest);
      if (color0 === color1) color0 = Math.min(65535, color1 + 1);
      if (color0 < color1) [color0, color1] = [color1, color0];
      const palette = makePalette(color0, color1);
      let indices = 0;
      for (let index = 0; index < colors.length; index++) {
        let best = 0;
        let bestDistance = Infinity;
        for (let candidate = 0; candidate < palette.length; candidate++) {
          const distance = colorDistance(colors[index], palette[candidate]);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = candidate;
          }
        }
        indices |= best << (index * 2);
      }
      output[outputOffset] = color0 & 255;
      output[outputOffset + 1] = color0 >>> 8;
      output[outputOffset + 2] = color1 & 255;
      output[outputOffset + 3] = color1 >>> 8;
      output[outputOffset + 4] = indices & 255;
      output[outputOffset + 5] = (indices >>> 8) & 255;
      output[outputOffset + 6] = (indices >>> 16) & 255;
      output[outputOffset + 7] = (indices >>> 24) & 255;
      outputOffset += 8;
    }
  }
  return output;
}

function luminance(color: [number, number, number]): number {
  return color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
}

function toRgb565(color: [number, number, number]): number {
  return ((color[0] >>> 3) << 11) | ((color[1] >>> 2) << 5) | (color[2] >>> 3);
}

function fromRgb565(value: number): [number, number, number] {
  return [
    Math.round(((value >>> 11) & 31) * 255 / 31),
    Math.round(((value >>> 5) & 63) * 255 / 63),
    Math.round((value & 31) * 255 / 31),
  ];
}

function makePalette(color0: number, color1: number): Array<[number, number, number]> {
  const a = fromRgb565(color0);
  const b = fromRgb565(color1);
  return [
    a,
    b,
    a.map((value, index) => Math.round((value * 2 + b[index]) / 3)) as [number, number, number],
    a.map((value, index) => Math.round((value + b[index] * 2) / 3)) as [number, number, number],
  ];
}

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  const red = a[0] - b[0];
  const green = a[1] - b[1];
  const blue = a[2] - b[2];
  return red * red + green * green + blue * blue;
}
