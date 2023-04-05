// Copyright (c) 2018-present, Cruise LLC

// This source code is licensed under the Apache License, Version 2.0,
// found in the LICENSE file in the root directory of this source tree.
// You may not use this file except in compliance with the License.

import Heap from "heap";

function nmerge<T>(key: (a: T, b: T) => number, ...iterables: Array<Iterator<T>>) {
  type Item = {
    i: number;
    value: T;
  };

  const heap: Heap<Item> = new Heap((a, b) => key(a.value, b.value));

  for (let i = 0; i < iterables.length; i++) {
    const { value, done } = iterables[i].next();

    if (!done) {
      heap.push({
        i,
        value,
      });
    }
  }

  return {
    next: () => {
      if (heap.empty()) {
        return {
          done: true,
        };
      }

      const { i } = heap.front() as Item;
      const next = iterables[i].next();

      if (next.done) {
        return {
          value: (heap.pop() as Item).value,
          done: false,
        };
      }

      return {
        value: heap.replace({
          i,
          value: next.value,
        }).value,
        done: false,
      };
    },
  };
}

export default nmerge;
