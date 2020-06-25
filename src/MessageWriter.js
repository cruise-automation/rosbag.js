// Copyright (c) 2018-present, Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// @flow

import int53 from "int53";
import type { Time } from "./types";
import { parseMessageDefinition, type RosMsgDefinition, type NamedRosMsgDefinition } from "./parseMessageDefinition";

// write a Time object to a buffer.
function writeTime(time: Time, buffer: Buffer, offset: number) {
  buffer.writeUInt32LE(time.sec, offset);
  buffer.writeUInt32LE(time.nsec, offset + 4);
}

class StandardTypeOffsetCalculator {
  offset = 0;

  // Returns the current offset and increments the next offset by `byteCount`.
  _incrementAndReturn(byteCount: number) {
    const offset = this.offset;
    this.offset += byteCount;
    return offset;
  }

  // These are not actually used in the StandardTypeWriter, so they must be kept in sync with those implementations.
  json(value: any) {
    return this.string(JSON.stringify(value));
  }

  // The following are used in the StandardTypeWriter.
  string(value: string) {
    // int32 length
    const length = 4 + value.length;
    return this._incrementAndReturn(length);
  }

  bool() {
    return this.uint8();
  }

  int8() {
    return this._incrementAndReturn(1);
  }

  uint8() {
    return this._incrementAndReturn(1);
  }

  int16() {
    return this._incrementAndReturn(2);
  }

  uint16() {
    return this._incrementAndReturn(2);
  }

  int32() {
    return this._incrementAndReturn(4);
  }

  uint32() {
    return this._incrementAndReturn(4);
  }

  float32() {
    return this._incrementAndReturn(4);
  }

  float64() {
    return this._incrementAndReturn(8);
  }

  int64() {
    return this._incrementAndReturn(8);
  }

  uint64() {
    return this._incrementAndReturn(8);
  }

  time() {
    return this._incrementAndReturn(8);
  }

  duration() {
    return this._incrementAndReturn(8);
  }
}

// this has hard-coded buffer writing functions for each
// of the standard message types http://docs.ros.org/api/std_msgs/html/index-msg.html
// eventually custom types decompose into these standard types
class StandardTypeWriter {
  buffer: Buffer;
  view: DataView;
  offsetCalculator: StandardTypeOffsetCalculator;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
    this.view = new DataView(buffer.buffer, buffer.byteOffset);
    this.offsetCalculator = new StandardTypeOffsetCalculator();
  }

  json(value: any) {
    this.string(JSON.stringify(value));
  }

  string(value: string) {
    const stringOffset = this.offsetCalculator.string(value);
    this.view.setInt32(stringOffset, value.length, true);
    this.buffer.write(value, stringOffset + 4, value.length, "ascii");
  }

  bool(value: bool) {
    this.uint8(value ? 1 : 0);
  }

  int8(value: number) {
    this.view.setInt8(this.offsetCalculator.int8(), value);
  }

  uint8(value: number) {
    this.view.setUint8(this.offsetCalculator.uint8(), value);
  }

  int16(value: number) {
    this.view.setInt16(this.offsetCalculator.int16(), value, true);
  }

  uint16(value: number) {
    this.view.setUint16(this.offsetCalculator.uint16(), value, true);
  }

  int32(value: number) {
    this.view.setInt32(this.offsetCalculator.int32(), value, true);
  }

  uint32(value: number) {
    this.view.setUint32(this.offsetCalculator.uint32(), value, true);
  }

  float32(value: number) {
    this.view.setFloat32(this.offsetCalculator.float32(), value, true);
  }

  float64(value: number) {
    this.view.setFloat64(this.offsetCalculator.float64(), value, true);
  }

  int64(value: number) {
    int53.writeInt64LE(value, this.buffer, this.offsetCalculator.int64());
  }

  uint64(value: number) {
    int53.writeUInt64LE(value, this.buffer, this.offsetCalculator.uint64());
  }

  time(time: Time) {
    writeTime(time, this.buffer, this.offsetCalculator.time());
  }

  duration(time: Time) {
    writeTime(time, this.buffer, this.offsetCalculator.time());
  }
}

const findTypeByName = (types: RosMsgDefinition[], name = ""): NamedRosMsgDefinition => {
  let foundName = ""; // track name separately in a non-null variable to appease Flow
  const matches = types.filter((type) => {
    const typeName = type.name || "";
    // if the search is empty, return unnamed types
    if (!name) {
      return !typeName;
    }
    // return if the search is in the type name
    // or matches exactly if a fully-qualified name match is passed to us
    const nameEnd = name.indexOf("/") > -1 ? name : `/${name}`;
    if (typeName.endsWith(nameEnd)) {
      foundName = typeName;
      return true;
    }
    return false;
  });
  if (matches.length !== 1) {
    throw new Error(`Expected 1 top level type definition for '${name}' but found ${matches.length}`);
  }
  return { ...matches[0], name: foundName };
};

const friendlyName = (name: string) => name.replace(/\//g, "_");

function createWriter(types: RosMsgDefinition[]): (message: any) => Buffer {
  const unnamedTypes = types.filter((type) => !type.name);
  if (unnamedTypes.length !== 1) {
    throw new Error("multiple unnamed types");
  }

  const [unnamedType] = unnamedTypes;

  const namedTypes: NamedRosMsgDefinition[] = (types.filter((type) => !!type.name): any[]);

  const constructorBody = (type: RosMsgDefinition | NamedRosMsgDefinition, argName: "offsetCalculator" | "writer") => {
    const writerLines: string[] = [];
    type.definitions.forEach((def) => {
      if (def.isConstant) {
        return;
      }

      // Accesses the field we are currently writing. Pulled out for easy reuse.
      const accessMessageField = `message["${def.name}"]`;
      if (def.isArray) {
        const lenField = `length_${def.name}`;
        // set a variable pointing to the parsed fixed array length
        // or write the byte indicating the dynamic length
        if (def.arrayLength) {
          writerLines.push(`var ${lenField} = ${def.arrayLength};`);
        } else {
          writerLines.push(`var ${lenField} = ${accessMessageField}.length;`);
          writerLines.push(`${argName}.uint32(${lenField});`);
        }

        // start the for-loop
        writerLines.push(`for (var i = 0; i < ${lenField}; i++) {`);
        // if the sub type is complex we need to allocate it and parse its values
        if (def.isComplex) {
          const defType = findTypeByName(types, def.type);
          // recursively call the function for the sub-type
          writerLines.push(`  ${friendlyName(defType.name)}(${argName}, ${accessMessageField}[i]);`);
        } else {
          // if the subtype is not complex its a simple low-level operation
          writerLines.push(`  ${argName}.${def.type}(${accessMessageField}[i]);`);
        }
        writerLines.push("}"); // close the for-loop
      } else if (def.isComplex) {
        const defType = findTypeByName(types, def.type);
        writerLines.push(`${friendlyName(defType.name)}(${argName}, ${accessMessageField});`);
      } else {
        // Call primitives directly.
        writerLines.push(`${argName}.${def.type}(${accessMessageField});`);
      }
    });
    return writerLines.join("\n    ");
  };

  let writerJs = "";
  let calculateSizeJs = "";

  namedTypes.forEach((t) => {
    writerJs += `
  function ${friendlyName(t.name)}(writer, message) {
    ${constructorBody(t, "writer")}
  };\n`;
    calculateSizeJs += `
  function ${friendlyName(t.name)}(offsetCalculator, message) {
    ${constructorBody(t, "offsetCalculator")}
  };\n`;
  });

  writerJs += `
  return function write(writer, message) {
    ${constructorBody(unnamedType, "writer")}
    return writer.buffer;
  };`;
  calculateSizeJs += `
  return function calculateSize(offsetCalculator, message) {
    ${constructorBody(unnamedType, "offsetCalculator")}
    return offsetCalculator.offset;
  };`;

  let _write: (writer: StandardTypeWriter, message: any) => Buffer;
  let _calculateSize: (offsetCalculator: StandardTypeOffsetCalculator, message: any) => number;
  try {
    _write = eval(`(function buildWriter() { ${writerJs} })()`);
  } catch (e) {
    console.error("error building writer:", writerJs); // eslint-disable-line no-console
    throw e;
  }
  try {
    _calculateSize = eval(`(function buildSizeCalculator() { ${calculateSizeJs} })()`);
  } catch (e) {
    console.error("error building size calculator:", calculateSizeJs); // eslint-disable-line no-console
    throw e;
  }

  return function(message: any) {
    const offsetCalculator = new StandardTypeOffsetCalculator();
    const bufferSize = _calculateSize(offsetCalculator, message);
    const buffer = new Buffer(bufferSize);
    const writer = new StandardTypeWriter(buffer);
    return _write(writer, message);
  };
}

export class MessageWriter {
  writer: (message: any) => Buffer;

  // takes a multi-line string message definition and returns
  // a message writer which can be used to write messages based
  // on the message definition
  constructor(messageDefinition: string) {
    const definitions = parseMessageDefinition(messageDefinition);
    this.writer = createWriter(definitions);
  }

  writeMessage(message: any) {
    return this.writer(message);
  }
}
