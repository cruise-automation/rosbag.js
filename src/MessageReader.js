// Copyright (c) 2018-present, Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// @flow

import int53 from "int53";
import { extractTime } from "./fields";
import type { RosMsgDefinition } from "./types";
import { parseMessageDefinition } from "./parseMessageDefinition";

type TypedArrayConstructor = (
  buffer: ArrayBuffer,
  byteOffset: number,
  length: number
) =>
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Uint8ClampedArray
  | Float32Array
  | Float64Array;

// this has hard-coded buffer reading functions for each
// of the standard message types http://docs.ros.org/api/std_msgs/html/index-msg.html
// eventually custom types decompose into these standard types
class StandardTypeReader {
  buffer: Buffer;
  offset: number;
  view: DataView;
  _decoder: ?TextDecoder;
  _decoderStatus: "NOT_INITIALIZED" | "INITIALIZED" | "NOT_AVAILABLE" = "NOT_INITIALIZED";

  constructor(buffer: Buffer) {
    this.buffer = buffer;
    this.offset = 0;
    this.view = new DataView(buffer.buffer, buffer.byteOffset);
  }

  _intializeTextDecoder() {
    if (typeof global.TextDecoder === "undefined") {
      this._decoderStatus = "NOT_AVAILABLE";
      return;
    }

    try {
      this._decoder = new global.TextDecoder("ascii");
      this._decoderStatus = "INITIALIZED";
    } catch (e) {
      // Swallow the error if we don't support ascii encoding.
      this._decoderStatus = "NOT_AVAILABLE";
    }
  }

  json(): mixed {
    const resultString = this.string();
    try {
      return JSON.parse(resultString);
    } catch {
      return `Could not parse ${resultString}`;
    }
  }

  string() {
    const len = this.int32();
    const codePoints = new Uint8Array(this.buffer.buffer, this.buffer.byteOffset + this.offset, len);
    this.offset += len;

    // if the string is relatively short we can use apply, but longer strings can benefit from the speed of TextDecoder.
    if (codePoints.length < 1000) {
      return String.fromCharCode.apply(null, codePoints);
    }

    // Use TextDecoder if it is available and supports the "ascii" encoding.
    if (this._decoderStatus === "NOT_INITIALIZED") {
      this._intializeTextDecoder();
    }
    if (this._decoder) {
      // TextDecoder does not support Uint8Arrays that are backed by SharedArrayBuffer, so copy the array here.
      // SharedArrayBuffer support has been added to the spec, but most browsers have not implemented this change.
      // See spec change: https://github.com/whatwg/encoding/pull/182
      // Track browser support here: https://github.com/whatwg/encoding/pull/182#issuecomment-539932294
      const input = codePoints.buffer instanceof global.SharedArrayBuffer ? new Uint8Array(codePoints) : codePoints;

      return this._decoder.decode(input);
    }

    // Otherwise, use string concatentation.
    let data = "";
    for (let i = 0; i < len; i++) {
      data += String.fromCharCode(codePoints[i]);
    }
    return data;
  }

  bool() {
    return this.uint8() !== 0;
  }

  int8() {
    return this.view.getInt8(this.offset++);
  }

  uint8() {
    return this.view.getUint8(this.offset++);
  }

  typedArray(len: ?number, arrayType: TypedArrayConstructor) {
    const arrayLength = len == null ? this.uint32() : len;
    const data = new arrayType(this.view.buffer, this.offset + this.view.byteOffset, arrayLength);
    this.offset += arrayLength;

    return data;
  }

  int16() {
    const result = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return result;
  }

  uint16() {
    const result = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return result;
  }

  int32() {
    const result = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return result;
  }

  uint32() {
    const result = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return result;
  }

  float32() {
    const result = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return result;
  }

  float64() {
    const result = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return result;
  }

  int64() {
    const offset = this.offset;
    this.offset += 8;
    return int53.readInt64LE(this.buffer, offset);
  }

  uint64() {
    const offset = this.offset;
    this.offset += 8;
    return int53.readUInt64LE(this.buffer, offset);
  }

  time() {
    const offset = this.offset;
    this.offset += 8;
    return extractTime(this.buffer, offset);
  }

  duration() {
    const offset = this.offset;
    this.offset += 8;
    return extractTime(this.buffer, offset);
  }
}

const findTypeByName = (types: RosMsgDefinition[], name: string): RosMsgDefinition => {
  const matches = types.filter((type) => type.name === name);
  if (matches.length !== 1) {
    throw new Error(`Expected 1 top level type definition for '${name}' but found ${matches.length}.`);
  }
  return matches[0];
};

const friendlyName = (name: string) => name.replace(/\//g, "_");

const createParser = (types: RosMsgDefinition[], typeName: string, freeze: boolean) => {
  const topLevelTypes = types.filter((type) => type.name === typeName);
  if (topLevelTypes.length !== 1) {
    throw new Error("multiple top-level types");
  }
  const [topLevelType] = topLevelTypes;

  const nestedTypes: RosMsgDefinition[] = types.filter((type) => type.name !== typeName);

  const constructorBody = (type: RosMsgDefinition) => {
    const readerLines: string[] = [];
    type.definitions.forEach((def) => {
      if (def.isConstant) {
        return;
      }
      if (def.isArray) {
        if (def.type === "uint8" || def.type === "int8") {
          const arrayType = def.type === "uint8" ? "Uint8Array" : "Int8Array";
          readerLines.push(`this.${def.name} = reader.typedArray(${String(def.arrayLength)}, ${arrayType});`);
          return;
        }

        const lenField = `length_${def.name}`;
        // set a variable pointing to the parsed fixed array length
        // or read the byte indicating the dynamic length
        readerLines.push(`var ${lenField} = ${def.arrayLength ? def.arrayLength : "reader.uint32();"}`);

        // only allocate an array if there is a length - skips empty allocations
        const arrayName = `this.${def.name}`;

        // allocate the new array to a fixed length since we know it ahead of time
        readerLines.push(`${arrayName} = new Array(${lenField})`);
        // start the for-loop
        readerLines.push(`for (var i = 0; i < ${lenField}; i++) {`);
        // if the sub type is complex we need to allocate it and parse its values
        if (def.isComplex) {
          const defType = findTypeByName(types, def.type);
          // recursively call the constructor for the sub-type
          readerLines.push(`  ${arrayName}[i] = new Record.${friendlyName(defType.name)}(reader);`);
        } else {
          // if the subtype is not complex its a simple low-level reader operation
          readerLines.push(`  ${arrayName}[i] = reader.${def.type}();`);
        }
        readerLines.push("}"); // close the for-loop
      } else if (def.isComplex) {
        const defType = findTypeByName(types, def.type);
        readerLines.push(`this.${def.name} = new Record.${friendlyName(defType.name)}(reader);`);
      } else {
        readerLines.push(`this.${def.name} = reader.${def.type}();`);
      }
    });
    if (freeze) {
      readerLines.push("Object.freeze(this);");
    }
    return readerLines.join("\n    ");
  };

  let js = `
  var Record = function (reader) {
    ${constructorBody(topLevelType)}
  };\n`;

  nestedTypes.forEach((t) => {
    js += `
  Record.${friendlyName(t.name)} = function(reader) {
    ${constructorBody(t)}
  };\n`;
  });

  js += `
  return function read(reader) {
    return new Record(reader);
  };`;

  let _read: (reader: StandardTypeReader) => any;
  try {
    _read = eval(`(function buildReader() { ${js} })()`);
  } catch (e) {
    console.error("error building parser:", js); // eslint-disable-line no-console
    throw e;
  }

  return function(buffer: Buffer) {
    const reader = new StandardTypeReader(buffer);
    return _read(reader);
  };
};

export class MessageReader {
  reader: (buffer: Buffer) => any;

  // takes an object message definition and returns
  // a message reader which can be used to read messages based
  // on the message definition
  constructor(definitions: RosMsgDefinition[], typeName: string, options: { freeze?: ?boolean } = {}) {
    let parsedDefinitions = definitions;
    if (typeof parsedDefinitions === "string") {
      // eslint-disable-next-line no-console
      console.warn(
        "Passing string message defintions to MessageReader is deprecated. Instead call `parseMessageDefinition` on it and pass in the resulting parsed message definition object."
      );
      parsedDefinitions = parseMessageDefinition(parsedDefinitions, typeName);
    }
    this.reader = createParser(parsedDefinitions, typeName, !!options.freeze);
  }

  readMessage(buffer: Buffer) {
    return this.reader(buffer);
  }
}
