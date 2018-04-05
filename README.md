# rosbag

`rosbag` is a node.js & browser compatible module for reading [rosbag](http://wiki.ros.org/rosbag) binary data files.

## Installation

```
npm install rosbag
```

or

```
yarn add rosbag
```

## Quick start

The most common way to interact with a rosbag is to read data records for a specific set of topics. The rosbag format [encodes type information for topics](http://wiki.ros.org/msg), and `rosbag` reads this type information and parses the data records into JavaScript objects and arrays.

Here is an example of reading messages from a rosbag in node.js:

```js
const { open } = require('rosbag');

// open a new bag at a given file location:
const bag = await open('../path/to/ros.bag');

// read all messages from both the '/foo' and '/bar' topics:
await bag.readMessages({ topics: ['/foo', '/bar'] }, (result) => {
  // topic is the topic the data record was in
  // in this case it will be either '/foo' or '/bar'
  console.log(result.topic);

  // message is the parsed payload
  // this payload will likely differ based on the topic
  console.log(result.message);
});
```

## API

### Opening a new rosbag reader

```js
// @flow signature
function open(fileOrPath: File | string) => Promise<Bag>
```

Opening a new rosbag reader is done with the `open` function. In the browser the function takes [a File instance](https://developer.mozilla.org/en-US/docs/Web/API/File) which you will generally get from a file input element. In node.js the function takes a string which should be the full path to a rosbag file. Node.js will read the file off of the disk. The promise will reject if there is an issue opening the file or if the file format is invalid, otherwise it will resolve with an instance of a `Bag`.

### Bag instance

```js
// @flow signature
class Bag {
  // the time of the earliest message in the bag
  startTime: Time,

  // the time of the last message in the bag
  endTime: Time,

  // a hash of connection records by their id
  connections: { [number]: Connection },

  // an array of ChunkInfos describing the chunks within the bag
  chunkInfos: Array<ChunkInfo>,

  // call to consume from the bag - see 'Consuming messages from the bag instance' below
  readMessages(options: BagOptions, cb: (result: ReadResult) => void) => Promise<void>
}
```

### Consuming messages from the bag instance

`bag.readMessages` method returns a `Promise<void>` which resolves when the read operation is completed or rejects in the event of a read error. _During_ the read operation individual `ReadResult` objects are passed to the `callback` supplied to the `open` function. The `callback` may be called multiple times on the same tick as multiple data records can be encoded within a single binary chunk read within the bag reader.

### BagOptions

```js
// @flow signature
const bagOptions = {

  // an optional array of topics used to filter down
  // which data records will be read
  // the default is all records on all topics
  topics?: Array<string>,

  // an optional Time instance used to filter data records
  // to only those which start on or after the given start time
  // the default is undefined which will apply no filter
  startTime?: Time,

  // an optional Time instance used to filter data records
  // to only those which end on or before the given end time
  // the default is undefined which will apply no filter
  endTime? Time,

  // decompression callbacks
  // if your bag is compressed you can supply a callback to decompress
  // based on the compression type. The callback should accept a buffer of compressed bytes
  // and return a buffer of uncompressed bytes
  decompress?: {|
    bz2?: (buffer: Buffer) => Buffer,
    lz4?: (buffer: Buffer) => Buffer,
  |}

  // by default the individual parsed binary messages will be parsed based on their [ROS message definition](http://wiki.ros.org/msg)
  // if you set noParse to true the read operation will skip the message parsing step
  noParse?: boolean
}
```

All options are optional and used to filter down from the sometimes enormous and varied data records in a rosbag. One could omit all options & filter the messages in memory within the `readMessages` callback; however, due to the rosbag format optimizations can be made during reading & parsing which will yield _significant_ performance and memory gains if you specify topics and/or date ranges ahead of time.

### ReadResult

```js
// @flow signature
const readResult {

  // the topic from which the current record was read
  topic: string,

  // the parsed message contents as a JavaScript object
  // this can contain nested complex types
  // and arrays of complex & simple types
  // this will be undefined if you supply { noParse: true } to `bag.readMessages`
  message: { [string]: any },

  // a Time instance - the receive time of the message
  timestamp: Time

  // the raw buffer data from the data record
  // a node.js buffer in node & an array buffer in the browser
  data: Array<int8>,

  // the offset of the chunk being read
  // starts at 0 and eventually increments to totalChunks
  // useful for computing read progress as a percentage
  chunkOffset: number,

  // the total chunks to eventually be consumed
  // during the current read operation
  totalChunks: number,
}
```

### Connection

```js
// @flow signature
class Connection {
  // the id of the connection
  conn: number,

  // the topic for the connection
  topic: string,

  // the md5 hash for the connection message definition
  md5sum: string,

  // the rosbag formatted message definition for records on this connection's topic
  messageDefinition: string,
}
```

### Time

The ROS format represents time to the nanosecond granularity. In JavaScript it is stored as an instance of the Time class. The time class has conversion helper methods to go to and from JavaScript dates.

```js
// @flow signature
class Time {
  // the seconds portion of the unix epoc
  sec: number,

  // the number of nanoseconds past the second of the unix epoc
  nsec: number,

  // the constructor expects a number for both the sec and nsec values
  constructor(sec: number, nsec: number),

  // convert this Time instance to a JavaScript date object
  // note: this is a lossy conversion as JavaScript dates do not store nanoseconds
  toDate(): Date,

  // helper method to build a time instance from a JavaScript date object
  static fromDate(Date): Time,

  // returns a positive number if left is greater than right
  // returns a negative number if right is greater than left
  // returns 0 if the times are the same
  // useful to sort an array of times:
  // const times = [new Time(1, 1000), new Time(2, 2000), new Time(0, 100)]
  // const sortedTimes = times.sort(Time.compare)
  static compare(left: Time, right: Time): number,

  // returns true if left is less than right, otherwise false
  static isLessThan(left: Time, right: Time): boolean,

  // returns true if left is greater than right, otherwise false
  static isGreaterThan(left: Time, right: Time): boolean,

  // returns true if the times are the same, otherwise false
  static areSame(left: Time, right: Time): boolean,

  // computes the sum of two times and returns a new time
  static add(left: Time, right: Time): Time,
}
```

You can import the Time module like this: `const { Time } = require('rosbag')`

## Supported platforms

Currently rosbag is used & heavily tested in `node@8.x` as well as google chrome (via webpack).  It should also work under all modern browsers which have the [FileReader](https://caniuse.com/#feat=filereader) and [typed array](https://caniuse.com/#feat=typedarrays) APIs available.  If you run into issues with Firefox, Edge, or Safari please feel free to open an issue or submit a pull request with a fix.

## LICENSE

This software is licensed under the Apache License, version 2 ("ALv2"), quoted below.

Copyright 2017-2018 GM Cruise

Licensed under the Apache License, Version 2.0 (the "License"); you may not
use this file except in compliance with the License. You may obtain a copy of
the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
License for the specific language governing permissions and limitations under
the License.
