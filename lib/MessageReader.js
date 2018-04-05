// Copyright (c) 2018-present, GM Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

import int53 from "int53";
import { extractTime } from "./fields";

// this has hard-coded buffer reading functions for each
// of the standard message types http://docs.ros.org/api/std_msgs/html/index-msg.html
// eventually custom types decompose into these standard types
class StandardTypeReader {
  constructor(buffer) {
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

  // byte is deprecated in the rosbag spec but still used
  byte() {
    return this.int8();
  }

  int8() {
    return this.view.getInt8(this.offset++);
  }

  uint8() {
    return this.view.getUint8(this.offset++);
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

// represents a single line in a message definition type
// e.g. 'string name' 'CustomType[] foo' 'string[3] names'
class Definition {
  constructor(type, name, isArray = false, arrayLength = undefined) {
    this.type = type;
    this.name = name;
    this.isArray = isArray;
    this.arrayLength = arrayLength;
    this.isComplex = !StandardTypeReader.prototype[type];
  }
}

// represents a definition of a custom type in a message definition
class ComplexType {
  constructor(name, definitions) {
    this.name = name;
    this.definitions = definitions;
  }
}

class CustomType {
  constructor(type, name, reader) {
    this.isCustom = true;
    this.name = name;
    this.type = type;
    this.reader = reader;
  }
}

const buildType = (lines, customParsers) => {
  const instructions = [];
  let complexTypeName;
  let customType;
  lines.forEach((line) => {
    // remove comments and extra whitespace from each line
    const splits = line
      .replace(/\t.+/gi, "")
      .replace(/#.*^/gi, "")
      .split(" ")
      .filter((word) => word);
    if (!splits[1]) {
      return;
    }
    // consume comments
    const type = splits[0].trim();
    const name = splits[1].trim();
    if (Object.keys(customParsers).indexOf(type) > -1) {
      customType = new CustomType(type, name, customParsers[type]);
    }
    if (type === "MSG:") {
      complexTypeName = name;
    } else if (name.indexOf("=") > -1 || splits.indexOf("=") > -1) {
      // constant type parsing
      // constants values are not part of individual records
    } else if (type.indexOf("]") === type.length - 1) {
      // array type parsing
      const typeSplits = type.split("[");
      const baseType = typeSplits[0];
      const arrayLength = parseInt(typeSplits[1].replace("]", ""), 10) || undefined;
      instructions.push(new Definition(baseType, name, true, arrayLength));
    } else {
      instructions.push(new Definition(type, name));
    }
  });
  return new ComplexType(complexTypeName, customType || instructions);
};

const findTypeByName = (types, name = "") => {
  const matches = types.filter((type) => {
    const typeName = type.name || "";
    // if the search is empty, return unnamed types
    if (!name) {
      return !typeName;
    }
    // return if the search is in the type name
    // or matches exactly if a fully-qualified name match is passed to us
    const nameEnd = name.indexOf("/") > -1 ? name : `/${name}`;
    return typeName.endsWith(nameEnd);
  });
  if (matches.length !== 1) {
    throw new Error(`Expected 1 top level type definition for '${name}' but found ${matches.length}`);
  }
  return matches[0];
};

const constructorBody = (type) => {
  if (type.definitions.isCustom) {
    return ";";
  }
  return type.definitions
    .map((def) => {
      return `this.${def.name} = undefined`;
    })
    .join(";\n");
};

const friendlyName = (name) => name.replace("/", "_");

const createParser = (types) => {
  const unnamedTypes = types.filter((type) => !type.name);
  if (unnamedTypes.length !== 1) {
    throw new Error("multiple unnmaed types");
  }

  const [unnamedType] = unnamedTypes;

  const namedTypes = types.filter((type) => !!type.name);

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
  const getReaderLines = (type, fieldName = "record") => {
    let readerLines = [];
    if (type.definitions.isCustom) {
      const def = type.definitions;
      readerLines.push(`${fieldName}.${def.name} = customParsers["${def.type}"](reader)`);
      return readerLines;
    }
    type.definitions.forEach((def) => {
      if (def.isArray) {
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

        if (def.type === "uint8") {
          readerLines.push(
            `${arrayName} = new Uint8Array(reader.buffer.buffer, reader.offset + reader.buffer.byteOffset, ${lenField});`,
            `reader.offset += ${lenField};`
          );
          return;
        }

        if (def.type === "int8") {
          readerLines.push(
            `${arrayName} = new Int8Array(reader.buffer.buffer, reader.offset + reader.buffer.byteOffset, ${lenField});`,
            `reader.offset += ${lenField};`
          );
          return;
        }

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
  return function read(reader, customParsers) {
    var record = new Record();
    ${lines}
    return record;
  };`;

  js += readerFn;

  let _read;
  try {
    _read = eval(`(function buildReader() { ${js} })()`); // eslint-disable-line
  } catch (e) {
    console.error("error building parser:", js); // eslint-disable-line
    throw e;
  }

  return function(buffer, customParsers) {
    const reader = new StandardTypeReader(buffer);
    return _read(reader, customParsers);
  };
};

export default class MessageReader {
  // takes a multi-line string message definition and returns
  // a message reader which can be used to read messages based
  // on the message definition
  constructor(messageDefinition = "", customParsers = {}) {
    // read all the lines and remove empties
    const allLines = messageDefinition
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line);

    let definitionLines = [];
    const types = [];
    // group lines into individual definitions
    allLines.forEach((line) => {
      // skip comment lines
      if (line.indexOf("#") === 0) {
        return;
      }
      // definitions are split by equal signs
      if (line.indexOf("==") === 0) {
        types.push(buildType(definitionLines, customParsers));
        definitionLines = [];
      } else {
        definitionLines.push(line);
      }
    });
    types.push(buildType(definitionLines, customParsers));
    this.customParsers = customParsers;
    this.reader = createParser(types);
  }

  readMessage(buffer) {
    return this.reader(buffer, this.customParsers);
  }
}
