// Copyright (c) 2018-present, GM Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// @flow

import int53 from "int53";
import { extractTime } from "./fields";
import { parseMessageDefinition, type RosMsgDefinition, type NamedRosMsgDefinition } from "./parseMessageDefinition";

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

  constructor(buffer: Buffer) {
    this.buffer = buffer;
    this.offset = 0;
    this.view = new DataView(buffer.buffer, buffer.byteOffset);
  }

  string() {
    const len = this.int32();
    const codePoints = new Uint8Array(this.buffer.buffer, this.buffer.byteOffset + this.offset, len);
    this.offset += len;
    // if the string is relatively short we can use apply
    // but very long strings can cause a stack overflow due to too many arguments
    // in those cases revert to a slower itterative string building approach
    if (codePoints.length < 1000) {
      return String.fromCharCode.apply(null, codePoints);
    }

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

const constructorBody = (type: $ReadOnly<RosMsgDefinition>) => {
  return type.definitions
    .filter((def) => !def.isConstant)
    .map((def) => {
      return `this.${def.name} = undefined`;
    })
    .join(";\n");
};

const friendlyName = (name: string) => name.replace("/", "_");

const createParser = (types: RosMsgDefinition[]) => {
  const unnamedTypes = types.filter((type) => !type.name);
  if (unnamedTypes.length !== 1) {
    throw new Error("multiple unnamed types");
  }

  const [unnamedType] = unnamedTypes;

  const namedTypes: NamedRosMsgDefinition[] = (types.filter((type) => !!type.name): any[]);

  let js = `
  var Record = function () {
    ${constructorBody(unnamedType)}
  };\n`;

  namedTypes.forEach((t) => {
    js += `
Record.${friendlyName(t.name)} = function() {
  ${constructorBody(t)}
};\n`;
  });

  let stack = 0;
  const getReaderLines = (type: RosMsgDefinition | NamedRosMsgDefinition, fieldName = "record") => {
    let readerLines: string[] = [];
    type.definitions.forEach((def) => {
      if (def.isConstant) {
        return;
      }
      if (def.isArray) {
        if (def.type === "uint8" || def.type === "int8") {
          const arrayType = def.type === "uint8" ? "Uint8Array" : "Int8Array";
          readerLines.push(`${fieldName}.${def.name} = reader.typedArray(${String(def.arrayLength)}, ${arrayType});`);
          return;
        }
        // because we might have nested arrays
        // we need to incrementally number varaibles so they aren't
        // stomped on by other variables in the function
        stack++;

        // name for the length field in the for-loop
        const lenField = `length_${stack}`;
        // name for a child collection
        const childName = `cplx_${stack}`;
        // name to the itterator in the for-loop
        const incName = `${childName}_inc_${stack}`;

        // set a variable pointing to the parsed fixed array length
        // or read the byte indicating the dynamic length
        readerLines.push(`var ${lenField} = ${def.arrayLength ? def.arrayLength : "reader.uint32();"}`);

        // only allocate an array if there is a length - skips empty allocations
        const arrayName = `${fieldName}.${def.name}`;

        // allocate the new array to a fixed length since we know it ahead of time
        readerLines.push(`${arrayName} = new Array(${lenField})`);
        // start the for-loop
        readerLines.push(`for (var ${incName} = 0; ${incName} < ${lenField}; ${incName}++) {`);
        // if the sub type is complex we need to allocate it and parse its values
        if (def.isComplex) {
          const defType = findTypeByName(types, def.type);
          readerLines.push(`var ${childName} = new Record.${friendlyName(defType.name)}();`);
          // recursively generate the parse instructions for the sub-type
          readerLines = readerLines.concat(getReaderLines(defType, `${childName}`));
          readerLines.push(`${arrayName}[${incName}] = ${childName}`);
        } else {
          // if the subtype is not complex its a simple low-level reader operation
          readerLines.push(`${arrayName}[${incName}] = reader.${def.type}();`);
        }
        readerLines.push("}"); // close the for-loop
      } else if (def.isComplex) {
        const defType = findTypeByName(types, def.type);
        readerLines.push(`${fieldName}.${def.name} = new Record.${friendlyName(defType.name)}();`);
        readerLines = readerLines.concat(getReaderLines(defType, `${fieldName}.${def.name}`));
      } else {
        readerLines.push(`${fieldName}.${def.name} = reader.${def.type}();`);
      }
    });
    return readerLines;
  };

  const lines = getReaderLines(unnamedType).join("\n");
  const readerFn = `
  return function read(reader) {
    var record = new Record();
    ${lines}
    return record;
  };`;

  js += readerFn;

  let _read: (reader: StandardTypeReader) => any;
  try {
    _read = eval(`(function buildReader() { ${js} })()`);
  } catch (e) {
    console.error("error building parser:", js); // eslint-disable-line
    throw e;
  }

  return function(buffer: Buffer) {
    const reader = new StandardTypeReader(buffer);
    return _read(reader);
  };
};

export class MessageReader {
  reader: (buffer: Buffer) => any;

  // takes a multi-line string message definition and returns
  // a message reader which can be used to read messages based
  // on the message definition
  constructor(messageDefinition: string) {
    const definitions = parseMessageDefinition(messageDefinition);
    this.reader = createParser(definitions);
  }

  readMessage(buffer: Buffer) {
    return this.reader(buffer);
  }
}
