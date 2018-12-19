// Copyright (c) 2018-present, GM Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// @flow

import { Buffer } from "buffer";
import { MessageReader, parseMessageDefinition, rosPrimitiveTypes, Time } from "../index";
import { type Callback } from "../types";
import Bag from "../bag";
import BagReader from "../BagReader";

// browser reader for Blob|File objects
export class Reader {
  _blob: Blob;
  _size: number;
  _fileReader: FileReader;

  constructor(blob: Blob) {
    this._blob = blob;
    this._size = blob.size;
    this._fileReader = new FileReader();
  }

  // read length (bytes) starting from offset (bytes)
  // callback(err, buffer)
  read(offset: number, length: number, cb: Callback<Buffer>) {
    const reader = this._fileReader;
    if (reader.onload) {
      return cb(new Error("Bag reader is already reading"));
    }

    reader.onload = function() {
      // $FlowFixMe - flow doesn't allow null
      reader.onload = null;
      reader.onerror = null;
      setImmediate(cb, null, Buffer.from(reader.result));
    };
    reader.onerror = function () {
      // $FlowFixMe - flow doesn't allow null
      reader.onload = null;
      reader.onerror = null;
      setImmediate(cb, new Error(reader.error));
    };
    reader.readAsArrayBuffer(this._blob.slice(offset, offset + length));
  }

  // return the size of the file
  size() {
    return this._size;
  }
}

const open = async (file: File) => {
  const bag = new Bag(new BagReader(new Reader(file)));
  await bag.open();
  return bag;
};

const BrowserBag: typeof Bag & { open(file: File): Promise<Bag> } = (Bag: any);
(BrowserBag: any).open = open;

export { Time, BagReader, MessageReader, open, parseMessageDefinition, rosPrimitiveTypes };
export default BrowserBag;
