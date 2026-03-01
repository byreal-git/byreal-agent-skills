import BN from 'bn.js';

// Convert 16-bit unsigned integer to byte array
export function u16ToBytes(num: number): Uint8Array {
  const arr = new ArrayBuffer(2);
  const view = new DataView(arr);
  view.setUint16(0, num, false);
  return new Uint8Array(arr);
}

// Convert 16-bit integer to byte array
export function i16ToBytes(num: number): Uint8Array {
  const arr = new ArrayBuffer(2);
  const view = new DataView(arr);
  view.setInt16(0, num, false);
  return new Uint8Array(arr);
}

// Convert 32-bit unsigned integer to byte array
export function u32ToBytes(num: number): Uint8Array {
  const arr = new ArrayBuffer(4);
  const view = new DataView(arr);
  view.setUint32(0, num, false);
  return new Uint8Array(arr);
}

// Convert 32-bit integer to byte array
export function i32ToBytes(num: number): Uint8Array {
  const arr = new ArrayBuffer(4);
  const view = new DataView(arr);
  view.setInt32(0, num, false);
  return new Uint8Array(arr);
}

// Find the position of the highest bit '1' in the bitmap
export function leadingZeros(bitNum: number, data: BN): number {
  let i = 0;
  for (let j = bitNum - 1; j >= 0; j--) {
    if (!data.testn(j)) {
      i++;
    } else {
      break;
    }
  }
  return i;
}

// Find the position of the lowest '0' in the bitmap
export function trailingZeros(bitNum: number, data: BN): number {
  let i = 0;
  for (let j = 0; j < bitNum; j++) {
    if (!data.testn(j)) {
      i++;
    } else {
      break;
    }
  }
  return i;
}

// Check if the bitmap is empty
export function isZero(bitNum: number, data: BN): boolean {
  for (let i = 0; i < bitNum; i++) {
    if (data.testn(i)) return false;
  }
  return true;
}

// Find the position of the highest bit '1' in the bitmap
export function mostSignificantBit(bitNum: number, data: BN): number | null {
  if (isZero(bitNum, data)) return null;
  else return leadingZeros(bitNum, data);
}

// Find the position of the lowest bit '1' in the bitmap
export function leastSignificantBit(bitNum: number, data: BN): number | null {
  if (isZero(bitNum, data)) return null;
  else return trailingZeros(bitNum, data);
}
