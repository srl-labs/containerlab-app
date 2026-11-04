/**
 * Just enough pcapng for the contract suites: write the stream a c9s lab host
 * sends (one section, one interface per target, Ethernet packets) and read
 * one back to check it.
 */

const SHB = 0x0a0d0d0a;
const IDB = 0x00000001;
const EPB = 0x00000006;
const LINKTYPE_ETHERNET = 1;
const OPT_IF_NAME = 2;
const OPT_SHB_USERAPPL = 4;
const OPT_IF_TSRESOL = 9;

function pad4(length: number): number {
  return Math.ceil(length / 4) * 4;
}

function option(code: number, value: Uint8Array): Uint8Array {
  const result = new Uint8Array(4 + pad4(value.byteLength));
  const view = new DataView(result.buffer);
  view.setUint16(0, code, true);
  view.setUint16(2, value.byteLength, true);
  result.set(value, 4);
  return result;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function block(type: number, body: Uint8Array): Uint8Array {
  const length = 12 + pad4(body.byteLength);
  const result = new Uint8Array(length);
  const view = new DataView(result.buffer);
  view.setUint32(0, type, true);
  view.setUint32(4, length, true);
  result.set(body, 8);
  view.setUint32(length - 4, length, true);
  return result;
}

const END_OF_OPTIONS = new Uint8Array(4);

export function sectionHeaderBlock(application: string): Uint8Array {
  const fixed = new Uint8Array(16);
  const view = new DataView(fixed.buffer);
  view.setUint32(0, 0x1a2b3c4d, true);
  view.setUint16(4, 1, true);
  view.setUint16(6, 0, true);
  view.setBigInt64(8, -1n, true);
  return block(SHB, concat([fixed, option(OPT_SHB_USERAPPL, new TextEncoder().encode(application)), END_OF_OPTIONS]));
}

/** An Ethernet interface named like containerlab names it, `<node>:<interface>`, with ns timestamps. */
export function interfaceDescriptionBlock(name: string, snapLength = 262_144): Uint8Array {
  const fixed = new Uint8Array(8);
  const view = new DataView(fixed.buffer);
  view.setUint16(0, LINKTYPE_ETHERNET, true);
  view.setUint32(4, snapLength, true);
  return block(
    IDB,
    concat([
      fixed,
      option(OPT_IF_NAME, new TextEncoder().encode(name)),
      option(OPT_IF_TSRESOL, new Uint8Array([9])),
      END_OF_OPTIONS
    ])
  );
}

export function enhancedPacketBlock(interfaceId: number, timestampNs: bigint, frame: Uint8Array): Uint8Array {
  const fixed = new Uint8Array(20);
  const view = new DataView(fixed.buffer);
  view.setUint32(0, interfaceId, true);
  view.setUint32(4, Number(timestampNs >> 32n), true);
  view.setUint32(8, Number(timestampNs & 0xffffffffn), true);
  view.setUint32(12, frame.byteLength, true);
  view.setUint32(16, frame.byteLength, true);
  return block(EPB, concat([fixed, frame, new Uint8Array(pad4(frame.byteLength) - frame.byteLength)]));
}

/** An Ethernet frame with an IPv4 ICMP echo request or reply. */
export function icmpEchoFrame(sequence: number, reply: boolean): Uint8Array {
  const frame = new Uint8Array(14 + 20 + 8 + 16);
  const view = new DataView(frame.buffer);
  frame.set([0x02, 0, 0, 0, 0, reply ? 1 : 2], 0);
  frame.set([0x02, 0, 0, 0, 0, reply ? 2 : 1], 6);
  view.setUint16(12, 0x0800);
  frame[14] = 0x45;
  view.setUint16(16, 20 + 8 + 16);
  frame[22] = 64;
  frame[23] = 1;
  frame.set(reply ? [10, 0, 0, 2, 10, 0, 0, 1] : [10, 0, 0, 1, 10, 0, 0, 2], 26);
  frame[34] = reply ? 0 : 8;
  view.setUint16(40, sequence);
  return frame;
}

export interface ParsedPcapng {
  sections: number;
  userApplication?: string;
  interfaces: { linkType: number; name?: string }[];
  packets: { interfaceId: number; frame: Uint8Array }[];
  /** Bytes after the last whole block. */
  trailing: number;
}

function readOptions(data: Uint8Array, offset: number, end: number): Map<number, Uint8Array> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const options = new Map<number, Uint8Array>();
  while (offset + 4 <= end) {
    const code = view.getUint16(offset, true);
    const length = view.getUint16(offset + 2, true);
    if (code === 0) break;
    options.set(code, data.slice(offset + 4, offset + 4 + length));
    offset += 4 + pad4(length);
  }
  return options;
}

/** Reads a little-endian pcapng stream; throws on anything but whole, well-formed blocks after an SHB. */
export function parsePcapng(data: Uint8Array): ParsedPcapng {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const result: ParsedPcapng = { sections: 0, interfaces: [], packets: [], trailing: 0 };
  let offset = 0;
  while (offset + 12 <= data.byteLength) {
    const type = view.getUint32(offset, true);
    const length = view.getUint32(offset + 4, true);
    if (length < 12 || length % 4 !== 0) throw new Error(`bad block length ${length} at ${offset}`);
    if (offset + length > data.byteLength) break;
    if (view.getUint32(offset + length - 4, true) !== length) throw new Error(`block at ${offset} does not end with its length`);
    if (offset === 0 && type !== SHB) throw new Error("the stream does not start with a Section Header Block");
    if (type === SHB) {
      if (view.getUint32(offset + 8, true) !== 0x1a2b3c4d) throw new Error("not a little-endian section");
      result.sections += 1;
      const appl = readOptions(data, offset + 24, offset + length - 4).get(OPT_SHB_USERAPPL);
      if (appl) result.userApplication = new TextDecoder().decode(appl);
    } else if (type === IDB) {
      const name = readOptions(data, offset + 16, offset + length - 4).get(OPT_IF_NAME);
      result.interfaces.push({
        linkType: view.getUint16(offset + 8, true),
        ...(name ? { name: new TextDecoder().decode(name) } : {})
      });
    } else if (type === EPB) {
      const captured = view.getUint32(offset + 20, true);
      result.packets.push({
        interfaceId: view.getUint32(offset + 8, true),
        frame: data.slice(offset + 28, offset + 28 + captured)
      });
    }
    offset += length;
  }
  result.trailing = data.byteLength - offset;
  return result;
}

/** Whether an Ethernet frame carries IPv4 ICMP (ping). */
export function isIcmpFrame(frame: Uint8Array): boolean {
  if (frame.byteLength < 34) return false;
  let offset = 12;
  let etherType = (frame[offset] << 8) | frame[offset + 1];
  // A VLAN tag before the IP header.
  if (etherType === 0x8100 && frame.byteLength >= 38) {
    offset += 4;
    etherType = (frame[offset] << 8) | frame[offset + 1];
  }
  return etherType === 0x0800 && frame[offset + 2 + 9] === 1;
}
