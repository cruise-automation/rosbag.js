# 2.5.0

* Added MessageWriter functionality, and deprecated passing the unparsed message definitions direction to MessageReader.

# 1.3.0

* Reorganized the repository, build using webpack, and export Flow type definitions.

# 1.2.1

* Updated MessageReader to ignore constant fields so they aren't set as keys on parsed messages.

# 1.2.0

* Updated parser to handle string and numeric constants.

# 1.1.4

* Normalize built-in type aliases: `char` to `uint8` and `byte` to `int8`.

# 1.1.3

* Changed `getTypes` to resolve unqualified type names to fully qualified names.

# 1.1.2

* Exposed `getTypes` function from MessageReader.

# 1.1.1

* Improved reading speed by reusing previously-allocated buffers

# 1.1.0

* Added `size` to decompression callbacks

# 1.0.3

* Removed `bluebird` dependency to reduce bundle size

# 1.0.2 (2018-04-05)

 * Increment reader offset after reading typed arrays ([#3](https://github.com/cruise-automation/rosbag.js/pull/3))

# 1.0.1 (2018-04-05)

  * initial release
