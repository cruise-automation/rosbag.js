// Copyright (c) 2018-present, GM Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

// browser reader for Blob|File objects
import { Buffer } from "buffer";

class Reader {
  constructor(blob) {
    this._blob = blob;
    this._size = blob.size;
    this._fileReader = new global.FileReader();
  }

  // read length (bytes) starting from offset (bytes)
  // callback(err, buffer)
  read(offset, length, cb) {
    const reader = this._fileReader;
    if (reader.onload) {
      return cb(new Error("Bag reader is already reading"));
    }

    reader.onload = function() {
      reader.onload = undefined;
      setImmediate(cb, null, new Buffer(reader.result));
    };
    reader.readAsArrayBuffer(this._blob.slice(offset, offset + length));
  }

  // return the size of the file
  size() {
    return this._size;
  }
}

export default Reader;
